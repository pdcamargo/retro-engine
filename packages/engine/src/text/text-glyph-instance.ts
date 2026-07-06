import type { Mat4 } from '@retro-engine/math';

import type { PositionedGlyph } from './text-layout';

/**
 * Per-instance byte size for a packed glyph quad. 13 `f32` slots — see
 * {@link packGlyphInstance} for the field layout. The vertex shader reads three
 * `float32x4` attributes plus one `unorm8x4` (48 + 4 = 52 bytes); the pipeline's
 * `arrayStride` must equal this.
 */
export const TEXT_INSTANCE_BYTE_SIZE = 52 as const;

/** 13 = `TEXT_INSTANCE_BYTE_SIZE / 4`. */
export const TEXT_INSTANCE_FLOAT_COUNT = 13 as const;

/** Block metrics needed to place a glyph relative to the entity origin. */
export interface GlyphBlock {
  /** Natural content width of the text block, in pixels. */
  readonly width: number;
  /** Block height, in pixels. */
  readonly height: number;
  /** Normalised pivot X (`0` = left edge at origin, `1` = right edge). */
  readonly anchorX: number;
  /** Normalised pivot Y (`0` = top edge at origin, `1` = bottom edge). */
  readonly anchorY: number;
}

/**
 * Pack one laid-out glyph quad into `f32View` + `u32View` at the supplied float
 * index. `f32View` and `u32View` must alias the same `ArrayBuffer`. Returns the
 * number of f32 slots consumed ({@link TEXT_INSTANCE_FLOAT_COUNT}).
 *
 * The glyph arrives in block-local pixel space (origin top-left, y **down**, as
 * {@link layoutText} produces). This transforms it into the entity's world
 * space: the block pivot `(anchorX, anchorY)` is placed at the entity origin,
 * block-local Y is flipped to the engine's Y-up world, and the entity's 2×2
 * affine (from `gtMatrix`) rotates/scales the quad. The vertex shader composes
 * corners as `center + quad_uv.x * basisX + quad_uv.y * basisY`, where
 * `quad_uv = (0, 0)` is the glyph's top-left.
 *
 * Per-instance layout (52 bytes):
 *
 * | bytes  | f32 slot | format    | `@location` | content                    |
 * |--------|----------|-----------|-------------|----------------------------|
 * | 0-15   | 0..3     | float32x4 | 2           | `center.xy` + `basisX.xy`  |
 * | 16-31  | 4..7     | float32x4 | 3           | `basisY.xy` + `uvMin.xy`   |
 * | 32-47  | 8..11    | float32x4 | 4           | `uvMax.xy` + `unitRange.xy` |
 * | 48-51  | 12       | unorm8x4  | 5           | packed RGBA tint           |
 *
 * `unitRange` is `distanceRange / atlasSize` per axis (in UV units), the MSDF
 * screen-pixel-range term the fragment shader needs for resolution-independent
 * antialiasing.
 *
 * @internal
 */
export const packGlyphInstance = (
  glyph: PositionedGlyph,
  block: GlyphBlock,
  gtMatrix: Mat4,
  unitRangeX: number,
  unitRangeY: number,
  packedColor: number,
  f32View: Float32Array,
  u32View: Uint32Array,
  floatIndex: number,
): number => {
  // Entity 2×2 affine (column-major): column 0 = local +X, column 1 = local +Y.
  const ax = gtMatrix[0] as number;
  const ay = gtMatrix[1] as number;
  const bx = gtMatrix[4] as number;
  const by = gtMatrix[5] as number;
  const tx = gtMatrix[12] as number;
  const ty = gtMatrix[13] as number;

  // quad_uv.x spans the glyph width; quad_uv.y spans its height. Block Y is
  // down, world Y is up, so the Y basis is negated.
  const basisXx = glyph.width * ax;
  const basisXy = glyph.width * ay;
  const basisYx = -glyph.height * bx;
  const basisYy = -glyph.height * by;

  // Block-local coordinates of the glyph's top-left corner, measured from the
  // block pivot: X right, Y up (flip the block's y-down).
  const localX0 = glyph.x - block.anchorX * block.width;
  const localY0 = block.anchorY * block.height - glyph.y;

  const centerX = tx + localX0 * ax + localY0 * bx;
  const centerY = ty + localX0 * ay + localY0 * by;

  f32View[floatIndex + 0] = centerX;
  f32View[floatIndex + 1] = centerY;
  f32View[floatIndex + 2] = basisXx;
  f32View[floatIndex + 3] = basisXy;

  f32View[floatIndex + 4] = basisYx;
  f32View[floatIndex + 5] = basisYy;
  f32View[floatIndex + 6] = glyph.u0;
  f32View[floatIndex + 7] = glyph.v0;

  f32View[floatIndex + 8] = glyph.u1;
  f32View[floatIndex + 9] = glyph.v1;
  f32View[floatIndex + 10] = unitRangeX;
  f32View[floatIndex + 11] = unitRangeY;

  u32View[floatIndex + 12] = packedColor;

  return TEXT_INSTANCE_FLOAT_COUNT;
};

/** Pack an RGBA quad of unit floats into a little-endian `unorm8x4` word. */
export const packColor = (r: number, g: number, b: number, a: number): number => {
  const rb = clampUnitToByte(r);
  const gb = clampUnitToByte(g);
  const bb = clampUnitToByte(b);
  const ab = clampUnitToByte(a);
  return (rb | (gb << 8) | (bb << 16) | (ab << 24)) >>> 0;
};

const clampUnitToByte = (v: number): number => {
  if (!(v > 0)) return 0;
  if (v >= 1) return 255;
  return Math.round(v * 255);
};
