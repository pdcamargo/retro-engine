// SpritePipeline Z-aware batching hot path (Renderer Phase 8.8 / ADR-0036):
//
// - Per frame the sprite prepare system collects `PerSpriteEntry` records for
//   every visible sprite, sorts them by `(bucketKey, -worldZ, imageHandle)`,
//   and walks the sorted list emitting a new `SpriteBatch` whenever
//   `(imageHandle, bucketKey)` changes between consecutive entries. The work
//   scales O(n log n) with sprite count — the sort step is the new cost
//   centre Phase 8.8 introduces over the pre-flip Phase 8.1 path.
//
// This bench fixtures 10 000 synthetic entries across two images at random
// Z values uniformly distributed over [-100, 100] and measures the combined
// sort + walk + pack pipeline against the public `sortAndEmitSpriteBatches`
// function. It bypasses the App harness — the entries, image-size lookup,
// and scratch buffers are synthesized directly so the measurement isolates
// the new sort path from the ECS query / asset upload pipeline.
//
// Performance budget (informational): the sort + walk step should stay
// under 0.5 ms at 10 000 sprites on the author's laptop. The escape hatch
// (if a future workload blows the budget) is encoding the sort-key triples
// into a `Float64Array` and sorting indices — a 3-5× speedup at the cost of
// a more complex permutation walk. Not adopted today because the current
// numbers do not justify it.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0036 (Z-aware
// sprite batching).

import { bench, summary } from 'mitata';

import { asAssetIndex, type Handle, makeHandle } from '@retro-engine/assets';
import { mat4, vec4 } from '@retro-engine/math';

import type { Entity } from '@retro-engine/ecs';
import type { Image } from '../src/image/image';
import type { GlobalTransform } from '../src/transform';
import {
  type PerSpriteEntry,
  sortAndEmitSpriteBatches,
  type SpriteImageSizeLookup,
} from '../src/sprite/sprite-batch-prepare';
import {
  SPRITE_INSTANCE_BYTE_SIZE,
  type SpriteBatch,
} from '../src/sprite/sprite-batch';
import { Sprite } from '../src/sprite/sprite';

const TOTAL_SPRITES = 10_000;
const IMAGE_COUNT = 2;

const imageHandles: Handle<Image>[] = [];
for (let i = 0; i < IMAGE_COUNT; i++) {
  imageHandles.push(makeHandle<Image>(asAssetIndex(100 + i)));
}

const imagesStub: SpriteImageSizeLookup = {
  get(): { width: number; height: number } {
    return { width: 16, height: 16 };
  },
};

// Deterministic PRNG so successive bench runs see identical Z distributions —
// `Math.random()` between iterations would let the sort path see varying
// degrees of presortedness and confuse measurements.
const mulberry32 = (seed: number): (() => number) => {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const rng = mulberry32(0xc0ffee);
const baseEntries: PerSpriteEntry[] = [];
for (let i = 0; i < TOTAL_SPRITES; i++) {
  const sprite = new Sprite({ color: vec4.create(1, 1, 1, 1) });
  const m = mat4.identity();
  const worldZ = (rng() - 0.5) * 200;
  m[14] = worldZ;
  const gt = { matrix: m } as unknown as GlobalTransform;
  baseEntries.push({
    entity: i as unknown as Entity,
    sprite,
    gt,
    bucket: 'opaque',
    bucketKey: 0,
    imageHandle: imageHandles[i % IMAGE_COUNT]!,
    worldZ,
  });
}

const scratchBuffer = new ArrayBuffer(TOTAL_SPRITES * SPRITE_INSTANCE_BYTE_SIZE);
const scratchF32 = new Float32Array(scratchBuffer);
const scratchU32 = new Uint32Array(scratchBuffer);

summary(() => {
  bench(
    `sortAndEmitSpriteBatches: sort + walk + pack ${TOTAL_SPRITES} sprites across ${IMAGE_COUNT} images`,
    () => {
      // `Array.sort` mutates in place — sort the same array twice and the
      // second call hits TimSort's O(n) sorted-input fast path, vastly
      // under-reporting real cost. Re-shuffle by slicing the immutable
      // baseEntries snapshot on every iteration so each measurement sorts
      // genuinely unsorted input.
      const working = baseEntries.slice();
      const out: SpriteBatch[] = [];
      sortAndEmitSpriteBatches(working, imagesStub, scratchF32, scratchU32, out);
    },
  );
});
