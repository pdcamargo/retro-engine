// Text prepare-path hot loop (ADR-0149, engine MSDF text):
//
// - Per-frame the text prepare system lays out every visible Text2d string into
//   positioned glyph quads, then packs each glyph's 13 floats into a scratch
//   buffer for one `writeBuffer` upload. Both steps scale with glyph count.
//
// This bench measures the combined layout + pack arithmetic for a wrapped
// multi-line paragraph, bypassing the App harness — it calls `layoutText` and
// `packGlyphInstance` directly against a synthetic ASCII font, isolating the
// prepare cost from the ECS query / asset pipeline.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0149 (text system).

import { bench, summary } from 'mitata';

import { mat4 } from '@retro-engine/math';

import { parseMsdfFont, type MsdfFontJson } from '../src/text/msdf-parser';
import { layoutText } from '../src/text/text-layout';
import {
  packColor,
  packGlyphInstance,
  TEXT_INSTANCE_FLOAT_COUNT,
} from '../src/text/text-glyph-instance';

// Synthetic font: every printable ASCII codepoint gets a glyph; space is a
// zero-quad advance. Atlas rects are placeholder — layout only reads advances +
// plane/atlas bounds, which is what the prepare cost depends on.
const glyphs: MsdfFontJson['glyphs'] = [];
for (let cp = 32; cp <= 126; cp++) {
  if (cp === 32) {
    glyphs.push({ unicode: 32, advance: 0.25 });
    continue;
  }
  const col = (cp - 33) % 16;
  const rowIdx = Math.floor((cp - 33) / 16);
  glyphs.push({
    unicode: cp,
    advance: 0.5,
    planeBounds: { left: 0.02, bottom: 0, right: 0.5, top: 0.72 },
    atlasBounds: { left: col * 32, bottom: rowIdx * 32, right: col * 32 + 30, top: rowIdx * 32 + 30 },
  });
}

const FONT_JSON: MsdfFontJson = {
  atlas: { type: 'msdf', distanceRange: 4, size: 32, width: 512, height: 512, yOrigin: 'bottom' },
  metrics: { emSize: 1, lineHeight: 1.25, ascender: 0.8, descender: -0.2 },
  glyphs,
};

const font = parseMsdfFont(FONT_JSON);

const PARAGRAPH = (
  'The quick brown fox jumps over the lazy dog. ' +
  'Pack my box with five dozen liquor jugs. ' +
  'How vexingly quick daft zebras jump! '
).repeat(4);

const gtMatrix = mat4.identity() as unknown as Float32Array;
const unitRangeX = font.distanceRange / font.atlasWidth;
const unitRangeY = font.distanceRange / font.atlasHeight;
const color = packColor(1, 1, 1, 1);

// Size the scratch to the laid-out glyph count once.
const probe = layoutText(font, PARAGRAPH, { fontSize: 24, maxWidth: 600 });
const scratchBuffer = new ArrayBuffer(probe.glyphs.length * TEXT_INSTANCE_FLOAT_COUNT * 4);
const scratchF32 = new Float32Array(scratchBuffer);
const scratchU32 = new Uint32Array(scratchBuffer);

summary(() => {
  bench(`text prepare: layout + pack ${probe.glyphs.length} glyphs (wrapped paragraph)`, () => {
    const layout = layoutText(font, PARAGRAPH, { fontSize: 24, maxWidth: 600 });
    const block = { width: layout.width, height: layout.height, anchorX: 0.5, anchorY: 0.5 };
    let cursor = 0;
    for (const glyph of layout.glyphs) {
      packGlyphInstance(glyph, block, gtMatrix, unitRangeX, unitRangeY, color, scratchF32, scratchU32, cursor);
      cursor += TEXT_INSTANCE_FLOAT_COUNT;
    }
  });
});
