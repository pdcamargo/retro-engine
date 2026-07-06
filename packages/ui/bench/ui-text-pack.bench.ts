// UI text glyph packing hot path (ADR-0154, in-game UI text):
//
// - Each frame the UI text prepare pass maps every laid-out glyph from screen
//   pixels to a clip-space quad and packs it into the instance buffer. Cost
//   scales with glyph count. This bench runs that map+pack loop over label-sized
//   glyph runs so a regression in the glyph packing path shows up here.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0154 (UI overlay pass).

import { bench, summary } from 'mitata';

import { packUiColor } from '../src/render/ui-instance';
import { packUiGlyph, UI_GLYPH_FLOAT_COUNT } from '../src/render/ui-glyph-instance';
import { computeClipRect } from '../src/render/ui-prepare';

const VIEWPORT_W = 1920;
const VIEWPORT_H = 1080;

interface GlyphSpec {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const buildGlyphs = (count: number): GlyphSpec[] => {
  const glyphs: GlyphSpec[] = [];
  for (let i = 0; i < count; i++) {
    glyphs.push({ x: 8 + (i % 60) * 14, y: 8 + Math.floor(i / 60) * 24, w: 12, h: 18 });
  }
  return glyphs;
};

const packAll = (glyphs: readonly GlyphSpec[], f32: Float32Array, u32: Uint32Array, color: number): void => {
  let cursor = 0;
  for (const g of glyphs) {
    const c = computeClipRect(g.x, g.y, g.w, g.h, VIEWPORT_W, VIEWPORT_H);
    packUiGlyph(c.left, c.top, c.right, c.bottom, 0.1, 0.1, 0.2, 0.2, 0.02, 0.02, color, f32, u32, cursor);
    cursor += UI_GLYPH_FLOAT_COUNT;
  }
};

summary(() => {
  const color = packUiColor(1, 1, 1, 1);
  for (const count of [128, 1024]) {
    const glyphs = buildGlyphs(count);
    const buffer = new ArrayBuffer(count * UI_GLYPH_FLOAT_COUNT * 4);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    bench(`packUiGlyphs ${count} glyphs`, () => {
      packAll(glyphs, f32, u32, color);
    });
  }
});
