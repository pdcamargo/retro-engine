// Mesh-material instancing hot path (instanced 3D/2D rendering):
//
// Per frame the material queue collects one entry per (visible entity × view),
// sorts them, and walks the sorted list emitting one instanced batch per run of
// identical (camera, bucket, mesh+material), packing each instance's transform
// into a shared buffer. `packInstancedBatches` is that sort + walk + pack step;
// its cost scales O(n log n) with entity count and shifts with how many distinct
// (mesh, material) combos the scene uses (fewer combos = bigger batches, the
// instancing win this work exists to capture).
//
// This bench fixtures synthetic entries directly — no App / ECS / GPU — so the
// measurement isolates the sort/walk/pack from the query and upload pipeline.
// Two grouping modes are measured: "free" (3D opaque — depth order irrelevant,
// maximal batching) and "depth-ordered" (2D / transparent — only adjacent
// same-key runs merge).
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import { mat4 } from '@retro-engine/math';

import {
  type AlphaBucket,
  type InstanceEntry,
  type InstancedDrawPayload,
  packInstancedBatches,
} from '../src/material/instance-batching';
import { MESH_INSTANCE_FLOAT_COUNT } from '../src/material/instance-layout';

const PAYLOAD = {} as unknown as InstancedDrawPayload;
const MODEL = mat4.identity();

const ENTITY_COUNTS = [1_000, 8_000] as const;
const COMBO_COUNTS = [1, 64] as const;

const FREE = new Set<AlphaBucket>(['blend']); // opaque entries are not in the set → grouped freely
const DEPTH_ORDERED = new Set<AlphaBucket>(['opaque', 'mask', 'blend']);

const mulberry32 = (seed: number): (() => number) => {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const buildEntries = (count: number, combos: number): InstanceEntry[] => {
  const rng = mulberry32(0xbada55 ^ count ^ (combos << 8));
  const entries: InstanceEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      cameraEntity: 1,
      bucket: 'opaque',
      groupKey: `${i % combos}`,
      depth: (rng() - 0.5) * 200,
      model: MODEL,
      payload: PAYLOAD,
    });
  }
  return entries;
};

for (const count of ENTITY_COUNTS) {
  for (const combos of COMBO_COUNTS) {
    const baseEntries = buildEntries(count, combos);
    const scratch = new Float32Array(count * MESH_INSTANCE_FLOAT_COUNT);

    summary(() => {
      // `Array.sort` mutates in place — re-slice the immutable snapshot each
      // iteration so every measurement sorts genuinely unsorted input.
      bench(`packInstancedBatches free @ ${count} entities, ${combos} combos`, () => {
        packInstancedBatches(baseEntries.slice(), FREE, scratch);
      });

      bench(`packInstancedBatches depth-ordered @ ${count} entities, ${combos} combos`, () => {
        packInstancedBatches(baseEntries.slice(), DEPTH_ORDERED, scratch);
      });
    });
  }
}
