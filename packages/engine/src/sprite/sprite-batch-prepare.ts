import type { Entity } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';

import type { ImageHandle } from '../image/images';
import type { GlobalTransform } from '../transform';

import type { Sprite } from './sprite';
import {
  packSpriteInstance,
  SPRITE_INSTANCE_FLOAT_COUNT,
  type SpriteAlphaBucket,
  type SpriteBatch,
} from './sprite-batch';

/**
 * One visible sprite collected by the prepare step, pre-decorated with the
 * fields the sort+walk hot path needs without re-walking the underlying
 * `GlobalTransform` matrix or re-deriving the alpha bucket. Pulling `worldZ`
 * and `bucketKey` onto the entry up-front keeps {@link sortAndEmitSpriteBatches}'s
 * comparator monomorphic in numeric ops — V8 inlines a numeric comparator
 * cleanly but degrades when the body deref's nested objects.
 *
 * @internal
 */
export interface PerSpriteEntry {
  readonly entity: Entity;
  readonly sprite: Sprite;
  readonly gt: GlobalTransform;
  readonly bucket: SpriteAlphaBucket;
  /** Numeric mirror of `bucket` — `0 = 'opaque'`, `1 = 'blend'` — used as the primary sort key. */
  readonly bucketKey: 0 | 1;
  readonly imageHandle: ImageHandle;
  /** `gt.matrix[14]` cached at collection time. */
  readonly worldZ: number;
}

/**
 * Minimal `Images.get`-shaped lookup used by {@link sortAndEmitSpriteBatches}
 * to resolve the source image's pixel dimensions per batch. Defined as a
 * structural interface so benches can substitute a plain `Map`-backed stub
 * without booting the engine's full asset pipeline.
 *
 * @internal
 */
export interface SpriteImageSizeLookup {
  get(handle: ImageHandle): { readonly width: number; readonly height: number } | undefined;
}

/**
 * Per-entity instance count: `9` for a 9-sliced sprite, `1` for the default
 * single-quad path. Used by the prepare loop to size the instance buffer
 * before packing; the actual per-instance writes come from
 * {@link packSpriteInstance}'s return value
 * (`consumed / SPRITE_INSTANCE_FLOAT_COUNT`).
 *
 * @internal
 */
export const instanceCountForSprite = (sprite: Sprite): number =>
  sprite.imageMode !== undefined && sprite.imageMode.kind === 'sliced' ? 9 : 1;

/**
 * Sort sprites by `(bucketKey, -worldZ, imageHandle)`, then walk the sorted
 * list once and emit a {@link SpriteBatch} whenever consecutive entries
 * differ on `(imageHandle, bucketKey)`. Packed instance bytes are written
 * into the supplied scratch views in walk order — the back-most entry of
 * each batch lands first, matching the back-to-front painter order the
 * Core2d phase nodes require.
 *
 * The sort key is bucket-primary so that a mixed opaque + blend scene
 * doesn't fragment same-image runs across the bucket boundary; ties at the
 * same `worldZ` resolve by `imageHandle` to keep same-image groups
 * contiguous. The walk-emit invariant: within each bucket, no batch
 * contains a sprite whose `worldZ` is strictly greater than any sprite's
 * `worldZ` in a batch that follows it.
 *
 * Best case (all same image + bucket) collapses to one batch. Worst case
 * (every consecutive Z transition swaps image) emits one batch per sprite —
 * correct draws, no batching — equivalent to the no-batching baseline.
 *
 * Returns the running scratch + instance cursors so the caller can issue a
 * single `writeBuffer` for the slice that was packed.
 *
 * @internal
 */
export const sortAndEmitSpriteBatches = (
  entries: PerSpriteEntry[],
  images: SpriteImageSizeLookup,
  scratchF32: Float32Array,
  scratchU32: Uint32Array,
  out: SpriteBatch[],
): { cursorFloats: number; cursorInstances: number } => {
  entries.sort((a, b) => {
    if (a.bucketKey !== b.bucketKey) return a.bucketKey - b.bucketKey;
    if (a.worldZ !== b.worldZ) return b.worldZ - a.worldZ;
    return a.imageHandle < b.imageHandle ? -1 : a.imageHandle > b.imageHandle ? 1 : 0;
  });

  let cursorFloats = 0;
  let cursorInstances = 0;
  let batchImage: ImageHandle | undefined;
  let batchBucketKey: 0 | 1 | undefined;
  let batchBucket: SpriteAlphaBucket | undefined;
  let batchStart = 0;
  let batchWorldZ = 0;
  let batchImageSize: { readonly width: number; readonly height: number } = { width: 1, height: 1 };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.imageHandle !== batchImage || e.bucketKey !== batchBucketKey) {
      if (batchImage !== undefined && batchBucket !== undefined) {
        const count = cursorInstances - batchStart;
        if (count > 0) {
          out.push({
            image: batchImage,
            bucket: batchBucket,
            firstInstance: batchStart,
            count,
            worldZ: batchWorldZ,
          });
        }
      }
      batchImage = e.imageHandle;
      batchBucket = e.bucket;
      batchBucketKey = e.bucketKey;
      batchStart = cursorInstances;
      batchWorldZ = e.worldZ;
      const sourceImage = images.get(e.imageHandle);
      batchImageSize = sourceImage !== undefined
        ? { width: sourceImage.width, height: sourceImage.height }
        : { width: 1, height: 1 };
    }
    const consumed = packSpriteInstance(
      e.sprite,
      e.gt.matrix as Mat4,
      batchImageSize,
      scratchF32,
      scratchU32,
      cursorFloats,
    );
    cursorFloats += consumed;
    cursorInstances += consumed / SPRITE_INSTANCE_FLOAT_COUNT;
  }

  if (batchImage !== undefined && batchBucket !== undefined) {
    const count = cursorInstances - batchStart;
    if (count > 0) {
      out.push({
        image: batchImage,
        bucket: batchBucket,
        firstInstance: batchStart,
        count,
        worldZ: batchWorldZ,
      });
    }
  }

  return { cursorFloats, cursorInstances };
};
