import { describe, expect, it } from 'bun:test';

import { type MsdfFontJson, parseMsdfFont } from './msdf-parser';

const FONT: MsdfFontJson = {
  atlas: { type: 'msdf', distanceRange: 4, size: 32, width: 100, height: 100, yOrigin: 'bottom' },
  metrics: { emSize: 1, lineHeight: 1.25, ascender: 0.8, descender: -0.2 },
  glyphs: [
    { unicode: 32, advance: 0.25 },
    {
      unicode: 65,
      advance: 0.5,
      planeBounds: { left: 0, bottom: 0, right: 0.5, top: 0.7 },
      atlasBounds: { left: 0, bottom: 0, right: 50, top: 70 },
    },
  ],
  kerning: [{ unicode1: 65, unicode2: 66, advance: -0.1 }],
};

describe('parseMsdfFont', () => {
  it('parses metrics, glyphs, and kerning from an object', () => {
    const font = parseMsdfFont(FONT);
    expect(font.metrics.lineHeight).toBe(1.25);
    expect(font.metrics.ascender).toBe(0.8);
    expect(font.distanceRange).toBe(4);
    expect(font.atlasWidth).toBe(100);
    expect(font.atlasHeight).toBe(100);
    expect(font.yOrigin).toBe('bottom');
    expect(font.glyphCount).toBe(2);

    const a = font.glyph(65);
    expect(a?.advance).toBe(0.5);
    expect(a?.plane?.top).toBe(0.7);
    expect(a?.atlas?.right).toBe(50);

    expect(font.kerning(65, 66)).toBe(-0.1);
    expect(font.kerning(66, 65)).toBe(0);
  });

  it('parses from a JSON string too', () => {
    const font = parseMsdfFont(JSON.stringify(FONT));
    expect(font.glyphCount).toBe(2);
  });

  it('leaves whitespace glyphs without plane/atlas rects', () => {
    const font = parseMsdfFont(FONT);
    const space = font.glyph(32);
    expect(space?.advance).toBe(0.25);
    expect(space?.plane).toBeUndefined();
    expect(space?.atlas).toBeUndefined();
  });

  it('reports unknown glyphs as undefined', () => {
    const font = parseMsdfFont(FONT);
    expect(font.glyph(0x263a)).toBeUndefined();
    expect(font.hasGlyph(0x263a)).toBe(false);
  });

  it('defaults yOrigin to bottom when absent', () => {
    const noOrigin: MsdfFontJson = {
      ...FONT,
      atlas: { type: 'msdf', distanceRange: 4, size: 32, width: 100, height: 100 },
    };
    expect(parseMsdfFont(noOrigin).yOrigin).toBe('bottom');
  });

  it('throws on a malformed font (missing metrics)', () => {
    expect(() => parseMsdfFont({ atlas: FONT.atlas, glyphs: [] })).toThrow(/metrics/);
  });

  it('throws on a non-numeric required field', () => {
    const bad = { ...FONT, atlas: { ...FONT.atlas, distanceRange: 'four' } };
    expect(() => parseMsdfFont(bad)).toThrow(/distanceRange/);
  });

  it('throws when glyphs is not an array', () => {
    expect(() => parseMsdfFont({ atlas: FONT.atlas, metrics: FONT.metrics, glyphs: {} })).toThrow(
      /glyphs/,
    );
  });
});
