import type { Mat4 } from '@retro-engine/math';

import type { ImageHandle } from '../image/images';

import { resolveAnchor, type Sprite } from './sprite';
import type { TextureSlicer } from './texture-slicer';

/**
 * Per-instance byte size for a packed sprite. 11 `f32` slots — see
 * {@link packSpriteInstance} for the field layout.
 *
 * The vertex shader reads four `@location()` attributes (two `float32x4`,
 * one `float32x2`, one `unorm8x4`) summing to 44 bytes; the
 * {@link RenderPipeline}'s `arrayStride` must equal this.
 */
export const SPRITE_INSTANCE_BYTE_SIZE = 44 as const;

/** 11 = `SPRITE_INSTANCE_BYTE_SIZE / 4`. */
export const SPRITE_INSTANCE_FLOAT_COUNT = 11 as const;

/**
 * Source-alpha buckets the queue system routes sprites into. Phase 8.1
 * approximates source alpha via the sprite tint — a sprite with `color.w === 1`
 * is treated as opaque, anything else as blend. Per-image source-alpha
 * analysis lands with the atlas asset.
 */
export type SpriteAlphaBucket = 'opaque' | 'blend';

/**
 * Internal: one batch the prepare pass emits, holding a contiguous slice of
 * the per-frame instance buffer destined for a single instanced draw.
 *
 * The queue system turns each batch into one `PhaseItem2d` whose `draw`
 * closure binds the batch's image, the instance-buffer slice, and records
 * `drawIndexed(6, count, 0, 0, baseInstance)`.
 *
 * `worldZ` is the *world-space* Z of the first sprite in the batch — the
 * queue system multiplies by the per-camera view matrix to derive the
 * camera-space `sortDepth` for the phase-item it pushes.
 *
 * @internal
 */
export interface SpriteBatch {
  readonly image: ImageHandle;
  readonly bucket: SpriteAlphaBucket;
  /** Index of the first sprite in this batch within the per-frame instance buffer. */
  readonly firstInstance: number;
  /** Number of sprites in this batch. */
  readonly count: number;
  /** World-space Z of the batch's first sprite, for per-camera sort key derivation. */
  readonly worldZ: number;
}

/**
 * Render-world resource holding the per-frame list of {@link SpriteBatch}es.
 * Populated by the sprite plugin's prepare system; consumed by its queue
 * system. Cleared at the start of every prepare pass.
 *
 * @internal
 */
export class SpritePreparedBatches {
  batches: SpriteBatch[] = [];
}

/**
 * Pack one sprite's per-instance data into `f32View` + `u32View` at the
 * supplied float index. `f32View` and `u32View` must alias the same
 * underlying `ArrayBuffer`. Returns the number of f32 slots consumed —
 * {@link SPRITE_INSTANCE_FLOAT_COUNT} for a plain sprite, or `9 ×
 * SPRITE_INSTANCE_FLOAT_COUNT` for a sprite carrying
 * `imageMode: { kind: 'sliced', ... }` (the function emits one instance per
 * slice region in fixed BL→BM→BR→ML→MM→MR→TL→TM→TR order).
 *
 * Per-instance layout (44 bytes):
 *
 * | bytes  | f32 slot | format     | `@location` | content                    |
 * |--------|----------|------------|-------------|----------------------------|
 * | 0-15   | 0..3     | float32x4  | 2           | `center.xy` + `basisX.xy`  |
 * | 16-31  | 4..7     | float32x4  | 3           | `basisY.xy` + `uvMin.xy`   |
 * | 32-39  | 8..9     | float32x2  | 4           | `uvMax.xy`                 |
 * | 40-43  | 10       | unorm8x4   | 5           | packed RGBA tint           |
 *
 * The sprite's footprint dimensions are sourced from `sprite.customSize` if
 * set, otherwise from the supplied `imageSize` (the source image's natural
 * pixel dimensions). The anchor + flip + rect fields produce the basis
 * vectors and source UV rectangle on the CPU; the vertex shader composes the
 * final corner positions as `center + uv.x * basisX + uv.y * basisY`.
 *
 * @internal
 */
export const packSpriteInstance = (
  sprite: Sprite,
  gtMatrix: Mat4,
  imageSize: { readonly width: number; readonly height: number },
  f32View: Float32Array,
  u32View: Uint32Array,
  floatIndex: number,
): number => {
  const mode = sprite.imageMode;
  if (mode !== undefined && mode.kind === 'sliced') {
    return packSlicedSpriteInstances(
      sprite,
      mode.slicer,
      gtMatrix,
      imageSize,
      f32View,
      u32View,
      floatIndex,
    );
  }

  const width = sprite.customSize !== undefined ? sprite.customSize[0]! : imageSize.width;
  const height = sprite.customSize !== undefined ? sprite.customSize[1]! : imageSize.height;

  // 2x2 affine columns from the world matrix (column-major, wgpu-matrix layout):
  //   column 0 = (m[0], m[1])   → "A"  (local +X axis in world space)
  //   column 1 = (m[4], m[5])   → "B"  (local +Y axis in world space)
  // Translation column (12, 13) is the entity's world position.
  const ax = gtMatrix[0] as number;
  const ay = gtMatrix[1] as number;
  const bx = gtMatrix[4] as number;
  const by = gtMatrix[5] as number;
  const tx = gtMatrix[12] as number;
  const ty = gtMatrix[13] as number;

  const basisXx = width * ax;
  const basisXy = width * ay;
  const basisYx = height * bx;
  const basisYy = height * by;

  // Anchor: offset the unit quad's (0, 0) corner so the anchor lands at the
  // entity origin. `(0, 0)` quad corner = origin - anchorX * basisX - anchorY * basisY.
  const [anchorX, anchorY] = resolveAnchor(sprite.anchor);
  const centerX = tx - anchorX * basisXx - anchorY * basisYx;
  const centerY = ty - anchorX * basisXy - anchorY * basisYy;

  // UV rect: defaults to the full image. flipX/flipY swap the corresponding
  // axis in source UV (output is still the unit quad, just sampling differently).
  let uMin = 0;
  let vMin = 0;
  let uMax = 1;
  let vMax = 1;
  if (sprite.rect !== undefined) {
    uMin = sprite.rect.min[0] as number;
    vMin = sprite.rect.min[1] as number;
    uMax = sprite.rect.max[0] as number;
    vMax = sprite.rect.max[1] as number;
  }
  if (sprite.flipX) {
    const t = uMin;
    uMin = uMax;
    uMax = t;
  }
  if (sprite.flipY) {
    const t = vMin;
    vMin = vMax;
    vMax = t;
  }

  // Pack 11 floats into f32View[floatIndex .. floatIndex+10]. The trailing
  // f32 slot is reinterpreted as a uint32 for the unorm8x4 colour.
  f32View[floatIndex + 0] = centerX;
  f32View[floatIndex + 1] = centerY;
  f32View[floatIndex + 2] = basisXx;
  f32View[floatIndex + 3] = basisXy;

  f32View[floatIndex + 4] = basisYx;
  f32View[floatIndex + 5] = basisYy;
  f32View[floatIndex + 6] = uMin;
  f32View[floatIndex + 7] = vMin;

  f32View[floatIndex + 8] = uMax;
  f32View[floatIndex + 9] = vMax;

  const r = clampUnitToByte(sprite.color[0] as number);
  const g = clampUnitToByte(sprite.color[1] as number);
  const b = clampUnitToByte(sprite.color[2] as number);
  const a = clampUnitToByte(sprite.color[3] as number);
  // WebGPU `unorm8x4` reads bytes in slot order — little-endian on every
  // supported backend, so the lowest byte is R.
  u32View[floatIndex + 10] = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;

  return SPRITE_INSTANCE_FLOAT_COUNT;
};

const clampUnitToByte = (v: number): number => {
  if (!(v > 0)) return 0;
  if (v >= 1) return 255;
  return Math.round(v * 255);
};

/**
 * Pack one 9-sliced sprite into nine per-instance records. Emits in fixed
 * BL → BM → BR → ML → MM → MR → TL → TM → TR order (bottom-up, left-to-right
 * within each row; Y is up in the engine's footprint-local space). Returns
 * `9 * SPRITE_INSTANCE_FLOAT_COUNT`.
 *
 * Border units are source-image pixels: an 8-pixel border carves an 8-pixel
 * inset off the sprite's source rect regardless of whether `sprite.rect`
 * names the full image or an atlas tile (the atlas image and the tile share
 * the same pixel scale). Destination corners stay at the border's pixel size
 * in world units; edges and centre stretch to fill the remaining footprint
 * (`customSize` or `imageSize` if undefined).
 *
 * If the footprint cannot accommodate the borders
 * (`border.left + border.right > W` or analogous on Y), the inner splits
 * cross and the affected slices degenerate to zero / negative basis — the
 * vertex shader produces empty quads rather than throwing.
 *
 * @internal
 */
const packSlicedSpriteInstances = (
  sprite: Sprite,
  slicer: TextureSlicer,
  gtMatrix: Mat4,
  imageSize: { readonly width: number; readonly height: number },
  f32View: Float32Array,
  u32View: Uint32Array,
  floatIndex: number,
): number => {
  const W = sprite.customSize !== undefined ? sprite.customSize[0]! : imageSize.width;
  const H = sprite.customSize !== undefined ? sprite.customSize[1]! : imageSize.height;

  // World affine — same layout as the single-quad path.
  const ax = gtMatrix[0] as number;
  const ay = gtMatrix[1] as number;
  const bx = gtMatrix[4] as number;
  const by = gtMatrix[5] as number;
  const tx = gtMatrix[12] as number;
  const ty = gtMatrix[13] as number;

  const fullBasisXx = W * ax;
  const fullBasisXy = W * ay;
  const fullBasisYx = H * bx;
  const fullBasisYy = H * by;

  const [anchorX, anchorY] = resolveAnchor(sprite.anchor);

  // Destination column / row boundaries in footprint-local [0, 1]² (Y-up).
  // Four x-boundaries (0, dxL, dxR, 1) frame three columns; same for rows.
  const border = slicer.border;
  const dxL = border.left / W;
  const dxR = 1 - border.right / W;
  const dyB = border.bottom / H;
  const dyT = 1 - border.top / H;

  // Source UV column / row boundaries inside `sprite.rect` (defaults to
  // [0, 1]² when undefined). Pixel-to-UV conversion uses the full source
  // image's pixel size, not the sub-rect's, so atlassed sprites carve at
  // the same physical pixel inset as standalone sprites.
  let uMinSrc = 0;
  let vMinSrc = 0;
  let uMaxSrc = 1;
  let vMaxSrc = 1;
  if (sprite.rect !== undefined) {
    uMinSrc = sprite.rect.min[0] as number;
    vMinSrc = sprite.rect.min[1] as number;
    uMaxSrc = sprite.rect.max[0] as number;
    vMaxSrc = sprite.rect.max[1] as number;
  }
  const uL = uMinSrc + border.left / imageSize.width;
  const uR = uMaxSrc - border.right / imageSize.width;
  const vB = vMinSrc + border.bottom / imageSize.height;
  const vT = vMaxSrc - border.top / imageSize.height;

  const xLocal = [0, dxL, dxR, 1] as const;
  const yLocal = [0, dyB, dyT, 1] as const;
  const uSrc = [uMinSrc, uL, uR, uMaxSrc] as const;
  const vSrc = [vMinSrc, vB, vT, vMaxSrc] as const;

  const flipX = sprite.flipX;
  const flipY = sprite.flipY;

  const r = clampUnitToByte(sprite.color[0] as number);
  const g = clampUnitToByte(sprite.color[1] as number);
  const b = clampUnitToByte(sprite.color[2] as number);
  const a = clampUnitToByte(sprite.color[3] as number);
  const packedColor = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;

  let cursor = floatIndex;
  for (let row = 0; row < 3; row++) {
    const yLo = yLocal[row]!;
    const yHi = yLocal[row + 1]!;
    let vLo = vSrc[row]!;
    let vHi = vSrc[row + 1]!;
    if (flipY) {
      const t = vLo;
      vLo = vHi;
      vHi = t;
    }
    const ySpan = yHi - yLo;
    const subBasisYx = ySpan * fullBasisYx;
    const subBasisYy = ySpan * fullBasisYy;

    for (let col = 0; col < 3; col++) {
      const xLo = xLocal[col]!;
      const xHi = xLocal[col + 1]!;
      let uLo = uSrc[col]!;
      let uHi = uSrc[col + 1]!;
      if (flipX) {
        const t = uLo;
        uLo = uHi;
        uHi = t;
      }
      const xSpan = xHi - xLo;
      const subBasisXx = xSpan * fullBasisXx;
      const subBasisXy = xSpan * fullBasisXy;

      // Sub-quad's (0, 0) corner sits at footprint-local (xLo, yLo). The
      // vertex shader writes `center + corner.x * basisX + corner.y * basisY`,
      // so `center` must be the world position of that sub-quad's (0, 0)
      // corner — derive by replacing the single-quad path's anchor subtract
      // with `(anchor − sliceOrigin) · fullBasis`.
      const subCenterX = tx - (anchorX - xLo) * fullBasisXx - (anchorY - yLo) * fullBasisYx;
      const subCenterY = ty - (anchorX - xLo) * fullBasisXy - (anchorY - yLo) * fullBasisYy;

      f32View[cursor + 0] = subCenterX;
      f32View[cursor + 1] = subCenterY;
      f32View[cursor + 2] = subBasisXx;
      f32View[cursor + 3] = subBasisXy;
      f32View[cursor + 4] = subBasisYx;
      f32View[cursor + 5] = subBasisYy;
      f32View[cursor + 6] = uLo;
      f32View[cursor + 7] = vLo;
      f32View[cursor + 8] = uHi;
      f32View[cursor + 9] = vHi;
      u32View[cursor + 10] = packedColor;
      cursor += SPRITE_INSTANCE_FLOAT_COUNT;
    }
  }
  return cursor - floatIndex;
};
