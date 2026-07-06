import { describe, expect, it } from 'bun:test';

import type { PositionedGlyph } from './text-layout';
import {
  packColor,
  packGlyphInstance,
  TEXT_INSTANCE_FLOAT_COUNT,
} from './text-glyph-instance';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
// 90° CCW rotation about Z: local +X → world +Y, local +Y → world −X.
const ROT90 = new Float32Array([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const glyph = (over: Partial<PositionedGlyph> = {}): PositionedGlyph => ({
  codepoint: 65,
  x: 10,
  y: 20,
  width: 30,
  height: 40,
  u0: 0.1,
  v0: 0.2,
  u1: 0.5,
  v1: 0.7,
  line: 0,
  ...over,
});

const pack = (g: PositionedGlyph, block: Parameters<typeof packGlyphInstance>[1], m: Float32Array) => {
  const f32 = new Float32Array(TEXT_INSTANCE_FLOAT_COUNT);
  const u32 = new Uint32Array(f32.buffer);
  packGlyphInstance(g, block, m, 0.0625, 0.0625, packColor(1, 1, 1, 1), f32, u32, 0);
  return { f32, u32 };
};

describe('packGlyphInstance', () => {
  it('packs a glyph under the identity transform (top-left anchor)', () => {
    const { f32 } = pack(glyph(), { width: 100, height: 50, anchorX: 0, anchorY: 0 }, IDENTITY);
    // basisX = width * X axis; basisY = -height * Y axis (block Y-down → world Y-up).
    expect(f32[2]).toBeCloseTo(30);
    expect(f32[3]).toBeCloseTo(0);
    expect(f32[4]).toBeCloseTo(0);
    expect(f32[5]).toBeCloseTo(-40);
    // center = top-left corner: localX0 = 10, localY0 = -20.
    expect(f32[0]).toBeCloseTo(10);
    expect(f32[1]).toBeCloseTo(-20);
    // UVs pass through (top-left origin).
    expect(f32[6]).toBeCloseTo(0.1);
    expect(f32[7]).toBeCloseTo(0.2);
    expect(f32[8]).toBeCloseTo(0.5);
    expect(f32[9]).toBeCloseTo(0.7);
    // unitRange.
    expect(f32[10]).toBeCloseTo(0.0625);
    expect(f32[11]).toBeCloseTo(0.0625);
  });

  it('offsets the block by its pivot', () => {
    const { f32 } = pack(glyph(), { width: 100, height: 50, anchorX: 0.5, anchorY: 0.5 }, IDENTITY);
    // localX0 = 10 - 0.5*100 = -40; localY0 = 0.5*50 - 20 = 5.
    expect(f32[0]).toBeCloseTo(-40);
    expect(f32[1]).toBeCloseTo(5);
  });

  it('applies the entity rotation to basis and center', () => {
    const { f32 } = pack(glyph(), { width: 100, height: 50, anchorX: 0, anchorY: 0 }, ROT90);
    // basisX = 30 * (0,1) = (0,30); basisY = -40 * (-1,0) = (40,0).
    expect(f32[2]).toBeCloseTo(0);
    expect(f32[3]).toBeCloseTo(30);
    expect(f32[4]).toBeCloseTo(40);
    expect(f32[5]).toBeCloseTo(0);
    // center = 10*(0,1) + (-20)*(-1,0) = (20,10).
    expect(f32[0]).toBeCloseTo(20);
    expect(f32[1]).toBeCloseTo(10);
  });

  it('returns the instance float count', () => {
    const f32 = new Float32Array(TEXT_INSTANCE_FLOAT_COUNT);
    const u32 = new Uint32Array(f32.buffer);
    const consumed = packGlyphInstance(
      glyph(),
      { width: 1, height: 1, anchorX: 0, anchorY: 0 },
      IDENTITY,
      0.1,
      0.1,
      0,
      f32,
      u32,
      0,
    );
    expect(consumed).toBe(TEXT_INSTANCE_FLOAT_COUNT);
  });
});

describe('packColor', () => {
  it('packs RGBA unit floats into a little-endian unorm8x4 word (R lowest)', () => {
    const word = packColor(1, 0, 0, 1);
    expect(word & 0xff).toBe(255); // R
    expect((word >>> 8) & 0xff).toBe(0); // G
    expect((word >>> 16) & 0xff).toBe(0); // B
    expect((word >>> 24) & 0xff).toBe(255); // A
  });

  it('clamps out-of-range components', () => {
    const word = packColor(-1, 0.5, 2, 1);
    expect(word & 0xff).toBe(0);
    expect((word >>> 8) & 0xff).toBe(128);
    expect((word >>> 16) & 0xff).toBe(255);
  });
});
