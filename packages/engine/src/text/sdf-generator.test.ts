import { describe, expect, it } from 'bun:test';

import { generateSdfFont, type SdfFontOptions, type StrokeGlyph } from './sdf-generator';

const OPTS: SdfFontOptions = {
  cellWidth: 4,
  ascent: 6,
  descent: 0,
  emUnits: 8,
  strokeHalfWidth: 1,
  pixelsPerUnit: 4,
  distanceRange: 4,
  padding: 2,
  lineGap: 0,
};

// A single glyph: a vertical bar at x = 2, y ∈ [0, 6].
const BAR: StrokeGlyph = { codepoint: 65, advance: 5, segments: [[2, 0, 2, 6]] };
const SPACE: StrokeGlyph = { codepoint: 32, advance: 4, segments: [] };

describe('generateSdfFont', () => {
  it('sizes the atlas from the padded cell geometry', () => {
    const { width, height } = generateSdfFont([BAR], OPTS);
    // cell width units = 4 + 2*(2/4) = 5 → 20px; height units = 6 + 1 = 7 → 28px.
    // One drawn glyph → columns = floor(sqrt(1)) + 1 = 2, rows = 1.
    expect(width).toBe(40);
    expect(height).toBe(28);
  });

  it('rasterizes a signed-distance gradient (inside 255, outside 0, soft edge between)', () => {
    const { rgba } = generateSdfFont([BAR], OPTS);
    let max = 0;
    let min = 255;
    let hasMid = false;
    for (let i = 0; i < rgba.length; i += 4) {
      const v = rgba[i]!;
      if (v > max) max = v;
      if (v < min) min = v;
      if (v > 20 && v < 235) hasMid = true;
      // Channels are replicated for the median-of-RGB shader.
      expect(rgba[i + 1]).toBe(v);
      expect(rgba[i + 2]).toBe(v);
      expect(rgba[i + 3]).toBe(255);
    }
    expect(max).toBe(255); // fully inside the bar
    expect(min).toBe(0); // far outside (padding corners)
    expect(hasMid).toBe(true); // antialiased ramp, not a hard mask
  });

  it('emits plane + atlas bounds for drawn glyphs and advance-only for whitespace', () => {
    const { font } = generateSdfFont([BAR, SPACE], OPTS);
    const bar = font.glyph(65);
    expect(bar?.advance).toBeCloseTo(5 / 8);
    expect(bar?.plane).toBeDefined();
    expect(bar?.atlas).toBeDefined();

    const space = font.glyph(32);
    expect(space?.advance).toBeCloseTo(4 / 8);
    expect(space?.plane).toBeUndefined();
    expect(space?.atlas).toBeUndefined();
  });

  it('derives font metrics in em units with a top-origin atlas', () => {
    const { font } = generateSdfFont([BAR], OPTS);
    expect(font.metrics.emSize).toBe(1);
    expect(font.metrics.ascender).toBeCloseTo(6 / 8);
    expect(font.metrics.descender).toBeCloseTo(0);
    expect(font.metrics.lineHeight).toBeCloseTo((6 + 0 + 0) / 8);
    expect(font.distanceRange).toBe(4);
    expect(font.yOrigin).toBe('top');
  });

  it('does not allocate atlas cells for whitespace-only glyphs', () => {
    const onlySpace = generateSdfFont([SPACE], OPTS);
    // No drawn glyphs → height falls back to the 1px floor.
    expect(onlySpace.height).toBe(1);
    expect(onlySpace.font.glyph(32)?.atlas).toBeUndefined();
  });
});
