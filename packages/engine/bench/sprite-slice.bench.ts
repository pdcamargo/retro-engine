// SpritePipeline prepare-path hot loop for 9-sliced sprites (Renderer Phase
// 8.5 / ADR-0034):
//
// - A 9-sliced sprite packs 9 per-instance records per entity instead of 1.
//   The slice math runs once per sprite (split tables computed inline, then
//   3×3 instance writes) — this bench measures that fan-out cost.
//
// Two variants run against the same 1000-entity fixture:
//
//   - "auto" — every sprite uses the default single-quad path (current Phase
//     8.1 cost; serves as the regression baseline next to
//     `sprite-batch.bench.ts`).
//   - "9-sliced" — every sprite carries `imageMode: { kind: 'sliced', … }`.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0034 (texture slicer).

import { bench, summary } from 'mitata';

import { mat4, vec2, vec4 } from '@retro-engine/math';

import { BorderRect, TextureSlicer } from '../src/sprite/texture-slicer';
import { Sprite } from '../src/sprite/sprite';
import {
  packSpriteInstance,
  SPRITE_INSTANCE_BYTE_SIZE,
} from '../src/sprite/sprite-batch';

const TOTAL_SPRITES = 1000;

// Shared transform fixture so the two benches measure only the pack-router
// branch and the slice math, not the matrix setup.
const matrices: Float32Array[] = [];
for (let i = 0; i < TOTAL_SPRITES; i++) {
  const m = mat4.identity();
  m[12] = (i % 32) * 2;
  m[13] = Math.floor(i / 32) * 2;
  matrices.push(m as unknown as Float32Array);
}

// Two parallel sprite arrays — same color / size to keep everything except
// `imageMode` constant across the comparison.
const autoSprites: Sprite[] = [];
const slicedSprites: Sprite[] = [];
const slicer = new TextureSlicer({ border: BorderRect.all(8) });
for (let i = 0; i < TOTAL_SPRITES; i++) {
  const opts = {
    color: vec4.create(1, 0.5 + 0.5 * Math.random(), 0.5, 1),
    customSize: vec2.create(96, 96),
  } as const;
  autoSprites.push(new Sprite(opts));
  slicedSprites.push(new Sprite({ ...opts, imageMode: { kind: 'sliced', slicer } }));
}

// Scratch buffer sized for the worst case (9× per sprite). Mitata reuses the
// same buffer across iterations, so the alloc cost stays out of the inner loop.
const scratchBuffer = new ArrayBuffer(TOTAL_SPRITES * 9 * SPRITE_INSTANCE_BYTE_SIZE);
const scratchF32 = new Float32Array(scratchBuffer);
const scratchU32 = new Uint32Array(scratchBuffer);

summary(() => {
  bench(
    `SpritePipeline.prepare: pack ${TOTAL_SPRITES} sprites (auto / 1 instance each)`,
    () => {
      let cursor = 0;
      for (let i = 0; i < TOTAL_SPRITES; i++) {
        cursor += packSpriteInstance(
          autoSprites[i]!,
          matrices[i]!,
          { width: 32, height: 32 },
          scratchF32,
          scratchU32,
          cursor,
        );
      }
    },
  );

  bench(
    `SpritePipeline.prepare: pack ${TOTAL_SPRITES} sprites (9-sliced / 9 instances each)`,
    () => {
      let cursor = 0;
      for (let i = 0; i < TOTAL_SPRITES; i++) {
        cursor += packSpriteInstance(
          slicedSprites[i]!,
          matrices[i]!,
          { width: 32, height: 32 },
          scratchF32,
          scratchU32,
          cursor,
        );
      }
    },
  );
});
