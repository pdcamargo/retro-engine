import { describe, expect, it } from 'bun:test';

import { mat4 } from '@retro-engine/math';

import {
  type AlphaBucket,
  type InstanceEntry,
  type InstancedDrawPayload,
  packInstancedBatches,
} from './instance-batching';
import { MESH_INSTANCE_FLOAT_COUNT } from './instance-layout';

// packInstancedBatches never inspects payload contents — a single shared stub
// is enough; the tests assert on grouping, counts, and packed floats.
const PAYLOAD = {} as unknown as InstancedDrawPayload;

const entry = (
  cameraEntity: number,
  bucket: AlphaBucket,
  groupKey: string,
  depth: number,
): InstanceEntry => ({ cameraEntity, bucket, groupKey, depth, model: mat4.identity(), payload: PAYLOAD });

const NONE = new Set<AlphaBucket>();
const ALL = new Set<AlphaBucket>(['opaque', 'mask', 'blend']);

describe('packInstancedBatches', () => {
  it('merges every same-key entry into one batch when the bucket is freely grouped', () => {
    const entries = [
      entry(1, 'opaque', 'A', 5),
      entry(1, 'opaque', 'A', 3),
      entry(1, 'opaque', 'A', 9),
    ];
    const scratch = new Float32Array(entries.length * MESH_INSTANCE_FLOAT_COUNT);
    const { batches, cursorFloats } = packInstancedBatches(entries, NONE, scratch);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.count).toBe(3);
    expect(batches[0]!.firstInstance).toBe(0);
    expect(cursorFloats).toBe(3 * MESH_INSTANCE_FLOAT_COUNT);
  });

  it('breaks a depth-ordered run when another group interleaves in depth', () => {
    // A@5, B@4, A@3 — depth-ordered, so the B at depth 4 splits the two A's.
    const entries = [entry(1, 'opaque', 'A', 5), entry(1, 'opaque', 'B', 4), entry(1, 'opaque', 'A', 3)];
    const scratch = new Float32Array(entries.length * MESH_INSTANCE_FLOAT_COUNT);
    const { batches } = packInstancedBatches(entries, ALL, scratch);

    // Sorted back-to-front: A@5, B@4, A@3 → three single-instance batches.
    expect(batches.map((b) => b.count)).toEqual([1, 1, 1]);
    expect(batches.map((b) => b.sortDepth)).toEqual([5, 4, 3]);
    // The same three entries group freely into two batches (A×2, B×1).
    const free = packInstancedBatches(
      [entry(1, 'opaque', 'A', 5), entry(1, 'opaque', 'B', 4), entry(1, 'opaque', 'A', 3)],
      NONE,
      new Float32Array(entries.length * MESH_INSTANCE_FLOAT_COUNT),
    );
    expect(free.batches.map((b) => b.count).sort()).toEqual([1, 2]);
  });

  it('merges adjacent same-key entries within a depth-ordered bucket', () => {
    // No interleaving group, so back-to-front A,A,A collapses to one batch.
    const entries = [entry(1, 'blend', 'A', 9), entry(1, 'blend', 'A', 5), entry(1, 'blend', 'A', 7)];
    const scratch = new Float32Array(entries.length * MESH_INSTANCE_FLOAT_COUNT);
    const { batches } = packInstancedBatches(entries, ALL, scratch);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.count).toBe(3);
    // Back-most first — the representative depth is the run's max.
    expect(batches[0]!.sortDepth).toBe(9);
  });

  it('never merges across cameras or buckets', () => {
    const entries = [
      entry(1, 'opaque', 'A', 1),
      entry(2, 'opaque', 'A', 1),
      entry(1, 'blend', 'A', 1),
    ];
    const scratch = new Float32Array(entries.length * MESH_INSTANCE_FLOAT_COUNT);
    const { batches } = packInstancedBatches(entries, new Set<AlphaBucket>(['blend']), scratch);
    expect(batches).toHaveLength(3);
  });

  it('packs contiguous firstInstance ranges and the right float count', () => {
    const entries = [
      entry(1, 'opaque', 'A', 1),
      entry(1, 'opaque', 'A', 1),
      entry(1, 'opaque', 'B', 1),
    ];
    const scratch = new Float32Array(entries.length * MESH_INSTANCE_FLOAT_COUNT);
    const { batches, cursorFloats } = packInstancedBatches(entries, NONE, scratch);

    const a = batches.find((b) => b.count === 2)!;
    const b = batches.find((b) => b.count === 1)!;
    expect(a.firstInstance).toBe(0);
    expect(b.firstInstance).toBe(2);
    expect(cursorFloats).toBe(3 * MESH_INSTANCE_FLOAT_COUNT);
    // First instance's packed model matrix is the identity we fed in.
    expect(scratch[0]).toBeCloseTo(1);
    expect(scratch[5]).toBeCloseTo(1);
  });
});
