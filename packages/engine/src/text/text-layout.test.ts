import { describe, expect, it } from 'bun:test';

import { MsdfFont } from './font';
import { type MsdfFontJson, parseMsdfFont } from './msdf-parser';
import { layoutText, measureText } from './text-layout';

// emSize 1 so fontSize maps 1:1 to em·px; two visible glyphs A/B, plus space.
const FONT_JSON: MsdfFontJson = {
  atlas: { type: 'msdf', distanceRange: 4, size: 32, width: 100, height: 100, yOrigin: 'bottom' },
  metrics: { emSize: 1, lineHeight: 1.25, ascender: 0.8, descender: -0.2 },
  glyphs: [
    { unicode: 32, advance: 0.25 },
    {
      unicode: 65, // 'A'
      advance: 0.5,
      planeBounds: { left: 0, bottom: 0, right: 0.5, top: 0.7 },
      atlasBounds: { left: 0, bottom: 0, right: 50, top: 70 },
    },
    {
      unicode: 66, // 'B'
      advance: 0.5,
      planeBounds: { left: 0, bottom: 0, right: 0.5, top: 0.7 },
      atlasBounds: { left: 50, bottom: 30, right: 100, top: 100 },
    },
  ],
  kerning: [{ unicode1: 65, unicode2: 66, advance: -0.1 }],
};

function font(): MsdfFont {
  return parseMsdfFont(FONT_JSON);
}

describe('layoutText', () => {
  it('positions a single-line run with kerning and advances', () => {
    const layout = layoutText(font(), 'AB', { fontSize: 100 });
    expect(layout.lineCount).toBe(1);
    expect(layout.glyphs).toHaveLength(2);

    const [a, b] = layout.glyphs;
    // ascentPx = 0.8 * 100 = 80; A: plane top 0.7 → y = 80 - 70 = 10, height 70.
    expect(a?.x).toBeCloseTo(0);
    expect(a?.y).toBeCloseTo(10);
    expect(a?.width).toBeCloseTo(50);
    expect(a?.height).toBeCloseTo(70);
    // B pen: A advance 50, then kerning A,B = -0.1 * 100 = -10 → x = 40.
    expect(b?.x).toBeCloseTo(40);
    // Content width = 50 + (-10) + 50 = 90.
    expect(layout.width).toBeCloseTo(90);
    expect(layout.height).toBeCloseTo(125);
  });

  it('flips bottom-origin atlas bounds into top-left UVs', () => {
    const [a] = layoutText(font(), 'A', { fontSize: 100 }).glyphs;
    expect(a?.u0).toBeCloseTo(0);
    expect(a?.u1).toBeCloseTo(0.5);
    // bottom origin: v0 = 1 - top/h = 1 - 0.7 = 0.3; v1 = 1 - bottom/h = 1.
    expect(a?.v0).toBeCloseTo(0.3);
    expect(a?.v1).toBeCloseTo(1);
  });

  it('honors top-origin atlases without flipping', () => {
    const topFont = parseMsdfFont({
      ...FONT_JSON,
      atlas: { ...FONT_JSON.atlas, yOrigin: 'top' },
    });
    const [a] = layoutText(topFont, 'A', { fontSize: 100 }).glyphs;
    expect(a?.v0).toBeCloseTo(0.7);
    expect(a?.v1).toBeCloseTo(0);
  });

  it('does not emit quads for whitespace', () => {
    const layout = layoutText(font(), 'A B', { fontSize: 100 });
    expect(layout.glyphs).toHaveLength(2);
    expect(layout.glyphs.every((g) => g.codepoint !== 0x20)).toBe(true);
  });

  it('breaks lines on explicit newlines', () => {
    const layout = layoutText(font(), 'A\nB', { fontSize: 100 });
    expect(layout.lineCount).toBe(2);
    expect(layout.height).toBeCloseTo(250);
    const [, b] = layout.glyphs;
    expect(b?.line).toBe(1);
    // line 1 baseline = 80 + 125 = 205; B top = 205 - 70 = 135.
    expect(b?.y).toBeCloseTo(135);
  });

  it('greedily wraps words at maxWidth', () => {
    // Each "AA" = 100px; space = 25px. maxWidth 250 fits two words, not three.
    const layout = layoutText(font(), 'AA AA AA', { fontSize: 100, maxWidth: 250 });
    expect(layout.lineCount).toBe(2);
    const linesOfB = new Set(layout.glyphs.map((g) => g.line));
    expect(linesOfB.has(0)).toBe(true);
    expect(linesOfB.has(1)).toBe(true);
  });

  it('overflows a single word wider than maxWidth rather than splitting it', () => {
    const layout = layoutText(font(), 'AAAA', { fontSize: 100, maxWidth: 50 });
    expect(layout.lineCount).toBe(1);
    expect(layout.glyphs).toHaveLength(4);
  });

  it('aligns lines within the block', () => {
    const left = layoutText(font(), 'A', { fontSize: 100, maxWidth: 200, align: 'left' });
    const center = layoutText(font(), 'A', { fontSize: 100, maxWidth: 200, align: 'center' });
    const right = layoutText(font(), 'A', { fontSize: 100, maxWidth: 200, align: 'right' });
    expect(left.glyphs[0]?.x).toBeCloseTo(0);
    // A advance 50 within a 200 box: center → (200-50)/2 = 75; right → 150.
    expect(center.glyphs[0]?.x).toBeCloseTo(75);
    expect(right.glyphs[0]?.x).toBeCloseTo(150);
  });

  it('applies letter spacing between glyphs', () => {
    const spaced = layoutText(font(), 'AB', { fontSize: 100, letterSpacing: 5 });
    const [, b] = spaced.glyphs;
    // A advance 50 + letterSpacing 5 + kerning -10 = 45.
    expect(b?.x).toBeCloseTo(45);
  });
});

describe('measureText', () => {
  it('matches layoutText bounds', () => {
    const opts = { fontSize: 100, maxWidth: 250 } as const;
    const laid = layoutText(font(), 'AA AA AA', opts);
    const measured = measureText(font(), 'AA AA AA', opts);
    expect(measured.width).toBeCloseTo(laid.width);
    expect(measured.height).toBeCloseTo(laid.height);
    expect(measured.lineCount).toBe(laid.lineCount);
  });

  it('measures multi-line height from line count', () => {
    const measured = measureText(font(), 'A\nB\nA', { fontSize: 100 });
    expect(measured.lineCount).toBe(3);
    expect(measured.height).toBeCloseTo(375);
  });
});
