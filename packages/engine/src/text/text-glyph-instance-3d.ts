import type { Mat4 } from '@retro-engine/math';

import type { GlyphBlock } from './text-glyph-instance';
import type { PositionedGlyph } from './text-layout';

/**
 * Per-instance byte size for a packed world-space (3D) glyph quad. 17 `f32` slots
 * — see {@link packGlyphInstance3d} for the field layout. The vertex shader reads
 * four `float32x4` attributes plus one `unorm8x4` (64 + 4 = 68 bytes); the
 * pipeline's `arrayStride` must equal this.
 *
 * Larger than the 2D 52-byte instance ({@link import('./text-glyph-instance').TEXT_INSTANCE_BYTE_SIZE})
 * because the glyph center + both quad basis vectors are 3D here, not 2D.
 */
export const TEXT3D_INSTANCE_BYTE_SIZE = 68 as const;

/** 17 = `TEXT3D_INSTANCE_BYTE_SIZE / 4`. */
export const TEXT3D_INSTANCE_FLOAT_COUNT = 17 as const;

/**
 * Pack one laid-out glyph quad into world (3D) space at the supplied float index.
 * `f32View` and `u32View` must alias the same `ArrayBuffer`. Returns the number of
 * f32 slots consumed ({@link TEXT3D_INSTANCE_FLOAT_COUNT}).
 *
 * The glyph arrives in block-local pixel space (origin top-left, y **down**, as
 * {@link import('./text-layout').layoutText} produces). It is transformed into the
 * entity's 3D world space via the `GlobalTransform` matrix: the block pivot
 * `(anchorX, anchorY)` is placed at the entity origin, block-local Y is flipped to
 * the engine's Y-up convention, and the world matrix's upper-left basis
 * (column 0 = local +X, column 1 = local +Y) orients + scales the quad on the
 * entity's plane. The vertex shader composes corners as
 * `center + quad_uv.x * basisX + quad_uv.y * basisY`, projected by the 3D camera's
 * `view_proj` — so, unlike the 2D packer, all three components are kept.
 *
 * Per-instance layout (68 bytes):
 *
 * | bytes  | f32 slot | format    | `@location` | content                     |
 * |--------|----------|-----------|-------------|-----------------------------|
 * | 0-15   | 0..3     | float32x4 | 2           | `center.xyz` + `unitRange.x`|
 * | 16-31  | 4..7     | float32x4 | 3           | `basisX.xyz` + `unitRange.y`|
 * | 32-47  | 8..11    | float32x4 | 4           | `basisY.xyz` + pad          |
 * | 48-63  | 12..15   | float32x4 | 5           | `uvMin.xy` + `uvMax.xy`     |
 * | 64-67  | 16       | unorm8x4  | 6           | packed RGBA tint            |
 *
 * @internal
 */
export const packGlyphInstance3d = (
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
  // World basis (column-major): column 0 = local +X, column 1 = local +Y.
  const c0x = gtMatrix[0] as number;
  const c0y = gtMatrix[1] as number;
  const c0z = gtMatrix[2] as number;
  const c1x = gtMatrix[4] as number;
  const c1y = gtMatrix[5] as number;
  const c1z = gtMatrix[6] as number;
  const tx = gtMatrix[12] as number;
  const ty = gtMatrix[13] as number;
  const tz = gtMatrix[14] as number;

  // quad_uv.x spans the glyph width; quad_uv.y spans its height. Block Y is down,
  // world Y is up, so the Y basis is negated.
  const basisXx = glyph.width * c0x;
  const basisXy = glyph.width * c0y;
  const basisXz = glyph.width * c0z;
  const basisYx = -glyph.height * c1x;
  const basisYy = -glyph.height * c1y;
  const basisYz = -glyph.height * c1z;

  // Block-local coordinates of the glyph's top-left corner, from the block pivot.
  const localX0 = glyph.x - block.anchorX * block.width;
  const localY0 = block.anchorY * block.height - glyph.y;

  const centerX = tx + localX0 * c0x + localY0 * c1x;
  const centerY = ty + localX0 * c0y + localY0 * c1y;
  const centerZ = tz + localX0 * c0z + localY0 * c1z;

  f32View[floatIndex + 0] = centerX;
  f32View[floatIndex + 1] = centerY;
  f32View[floatIndex + 2] = centerZ;
  f32View[floatIndex + 3] = unitRangeX;

  f32View[floatIndex + 4] = basisXx;
  f32View[floatIndex + 5] = basisXy;
  f32View[floatIndex + 6] = basisXz;
  f32View[floatIndex + 7] = unitRangeY;

  f32View[floatIndex + 8] = basisYx;
  f32View[floatIndex + 9] = basisYy;
  f32View[floatIndex + 10] = basisYz;
  f32View[floatIndex + 11] = 0;

  f32View[floatIndex + 12] = glyph.u0;
  f32View[floatIndex + 13] = glyph.v0;
  f32View[floatIndex + 14] = glyph.u1;
  f32View[floatIndex + 15] = glyph.v1;

  u32View[floatIndex + 16] = packedColor;

  return TEXT3D_INSTANCE_FLOAT_COUNT;
};
