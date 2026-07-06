import { describe, expect, it } from 'bun:test';

import { packColor } from './text-glyph-instance';
import { packGlyphInstance3d, TEXT3D_INSTANCE_FLOAT_COUNT } from './text-glyph-instance-3d';
import type { PositionedGlyph } from './text-layout';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
// Translate (5, 6, 7).
const TRANSLATE = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
// 90° rotation about Y (column-major): local +X → world (0, 0, −1), local +Y → world +Y.
const ROTY90 = new Float32Array([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]);

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

const pack = (g: PositionedGlyph, block: Parameters<typeof packGlyphInstance3d>[1], m: Float32Array) => {
  const f32 = new Float32Array(TEXT3D_INSTANCE_FLOAT_COUNT);
  const u32 = new Uint32Array(f32.buffer);
  packGlyphInstance3d(g, block, m, 0.0625, 0.0625, packColor(1, 1, 1, 1), f32, u32, 0);
  return f32;
};

/** Per-component closeness (treats `-0 ≈ 0`, which `toEqual` does not). */
const expectVec3 = (v: readonly [number, number, number], expected: readonly [number, number, number]): void => {
  expected.forEach((x, i) => expect(v[i]!).toBeCloseTo(x, 5));
};

describe('packGlyphInstance3d', () => {
  it('packs a glyph under the identity transform (top-left anchor), center on z=0', () => {
    const f32 = pack(glyph(), { width: 100, height: 50, anchorX: 0, anchorY: 0 }, IDENTITY);
    // center = top-left corner in the entity plane: localX0 = 10, localY0 = -20, z = 0.
    expect(f32[0]).toBeCloseTo(10);
    expect(f32[1]).toBeCloseTo(-20);
    expect(f32[2]).toBeCloseTo(0);
    // basisX = width * X axis (3D); basisY = -height * Y axis (block Y-down → world Y-up).
    expectVec3([f32[4]!, f32[5]!, f32[6]!], [30, 0, 0]);
    expectVec3([f32[8]!, f32[9]!, f32[10]!], [0, -40, 0]);
    // unitRange packed into the two basis w-slots; uv rect passes through.
    expect(f32[3]).toBeCloseTo(0.0625);
    expect(f32[7]).toBeCloseTo(0.0625);
    expect([f32[12], f32[13], f32[14], f32[15]]).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.5),
      Math.fround(0.7),
    ]);
  });

  it('carries the entity translation into the 3D center (including z)', () => {
    const f32 = pack(glyph(), { width: 100, height: 50, anchorX: 0, anchorY: 0 }, TRANSLATE);
    expect(f32[0]).toBeCloseTo(15); // 10 + 5
    expect(f32[1]).toBeCloseTo(-14); // -20 + 6
    expect(f32[2]).toBeCloseTo(7); // 0 + 7
  });

  it('orients the quad in 3D under a Y rotation (basisX gains a z component)', () => {
    const f32 = pack(glyph(), { width: 100, height: 50, anchorX: 0, anchorY: 0 }, ROTY90);
    // basisX = 30 * (0, 0, -1) = (0, 0, -30); basisY = -40 * (0, 1, 0) = (0, -40, 0).
    expectVec3([f32[4]!, f32[5]!, f32[6]!], [0, 0, -30]);
    expectVec3([f32[8]!, f32[9]!, f32[10]!], [0, -40, 0]);
    // center = 10*(0,0,-1) + (-20)*(0,1,0) = (0, -20, -10).
    expect(f32[0]).toBeCloseTo(0);
    expect(f32[1]).toBeCloseTo(-20);
    expect(f32[2]).toBeCloseTo(-10);
  });

  it('returns the instance float count', () => {
    const f32 = new Float32Array(TEXT3D_INSTANCE_FLOAT_COUNT);
    const u32 = new Uint32Array(f32.buffer);
    const consumed = packGlyphInstance3d(
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
    expect(consumed).toBe(TEXT3D_INSTANCE_FLOAT_COUNT);
  });
});
