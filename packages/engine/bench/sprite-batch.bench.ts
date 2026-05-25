// SpritePipeline prepare-path hot loop (Renderer Phase 8.1 / ADR-0031):
//
// - Per-frame the sprite prepare system iterates every visible Sprite,
//   computes its world-space affine, packs 11 floats per instance into a
//   scratch buffer, groups by (image, alphaBucket), and emits one
//   `writeBuffer` upload. The work scales linearly with sprite count.
//
// This bench measures the packing path against a 1000-sprite fixture split
// across four images. It bypasses the App harness — we call
// `packSpriteInstance` directly with synthetic GlobalTransform matrices, so
// the measurement isolates the prepare arithmetic from the ECS query / asset
// pipeline.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0031 (sprite pipeline).

import { bench, summary } from 'mitata';

import { mat4, vec4 } from '@retro-engine/math';

import { Sprite } from '../src/sprite/sprite';
import {
  packSpriteInstance,
  SPRITE_INSTANCE_BYTE_SIZE,
} from '../src/sprite/sprite-batch';

const TOTAL_SPRITES = 1000;
const BATCH_COUNT = 4;

const sprites: Sprite[] = [];
const matrices: Float32Array[] = [];
for (let i = 0; i < TOTAL_SPRITES; i++) {
  // Mix bucket so the bench reflects real-world packing (alpha bucket is
  // computed downstream by the queue, but the per-instance bytes are the same
  // regardless).
  sprites.push(
    new Sprite({
      color: vec4.create(1, 0.5 + 0.5 * Math.random(), 0.5, 1),
    }),
  );
  const m = mat4.identity();
  m[12] = (i % 32) * 2;
  m[13] = Math.floor(i / 32) * 2;
  matrices.push(m as unknown as Float32Array);
}

const scratchBuffer = new ArrayBuffer(
  TOTAL_SPRITES * SPRITE_INSTANCE_BYTE_SIZE,
);
const scratchF32 = new Float32Array(scratchBuffer);
const scratchU32 = new Uint32Array(scratchBuffer);

summary(() => {
  bench(
    `SpritePipeline.prepare: pack ${TOTAL_SPRITES} sprites into ${BATCH_COUNT} batches`,
    () => {
      let cursor = 0;
      for (let i = 0; i < TOTAL_SPRITES; i++) {
        cursor += packSpriteInstance(
          sprites[i]!,
          matrices[i]!,
          { width: 16, height: 16 },
          scratchF32,
          scratchU32,
          cursor,
        );
      }
    },
  );
});
