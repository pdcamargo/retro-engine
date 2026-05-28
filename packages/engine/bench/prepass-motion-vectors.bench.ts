// Prepass packing cost when the motion-vector channel is active vs not.
//
// The motion-vector slice (ADR-0051) adds one extra per-instance write into
// a sibling Float32Array carrying the previous-frame model matrix, packed
// in lockstep with the current-frame instance buffer. The new pack helper
// is `packPreviousInstanceTransform` (16 floats per instance, single
// `Float32Array.set`); the existing `packInstanceTransform` writes 32 floats
// per instance (model + inverse-transpose).
//
// This bench measures the marginal cost of the previous-instance loop on top
// of the existing current-instance pack at ~1000 PBR meshes — the
// throughput-headroom check for camera setups that opt into motion vectors.
//
// See docs/adr/ADR-0017 (bench schema) and ADR-0051 (motion vectors).

import { bench, do_not_optimize, group, summary } from 'mitata';

import { mat4 } from '@retro-engine/math';

import {
  type AlphaBucket,
  type InstanceEntry,
  type InstancedDrawPayload,
  packInstancedBatches,
} from '../src/material/instance-batching';
import {
  MESH_INSTANCE_FLOAT_COUNT,
  PREVIOUS_INSTANCE_FLOAT_COUNT,
  packPreviousInstanceTransform,
} from '../src/material/instance-layout';

const COUNT = 1_000;
const MODEL = mat4.identity();
const PAYLOAD = {} as unknown as InstancedDrawPayload;
const FREE = new Set<AlphaBucket>(['blend']); // opaque grouped freely

const buildEntries = (count: number, withPrevious: boolean): InstanceEntry[] => {
  const entries: InstanceEntry[] = [];
  for (let i = 0; i < count; i++) {
    const entry: InstanceEntry = {
      cameraEntity: 1,
      bucket: 'opaque',
      groupKey: `${i % 8}`,
      depth: i,
      model: MODEL,
      payload: PAYLOAD,
      ...(withPrevious ? { previousModel: MODEL } : {}),
    };
    entries.push(entry);
  }
  return entries;
};

const currentScratch = new Float32Array(COUNT * MESH_INSTANCE_FLOAT_COUNT);
const previousScratch = new Float32Array(COUNT * PREVIOUS_INSTANCE_FLOAT_COUNT);

summary(() => {
  group(`Prepass pack @ ${COUNT} PBR meshes`, () => {
    bench('depth-only / depth+normal (current-instance pack only)', () => {
      const entries = buildEntries(COUNT, false);
      const { batches, cursorFloats } = packInstancedBatches(entries, FREE, currentScratch);
      do_not_optimize(batches);
      do_not_optimize(cursorFloats);
    });

    bench('depth+normal+motion (current + previous-instance pack)', () => {
      const entries = buildEntries(COUNT, true);
      const { batches, cursorFloats } = packInstancedBatches(entries, FREE, currentScratch);
      // Lockstep previous-instance pack — mirrors MaterialPluginState's
      // sorted-entries iteration after the main pack.
      let prevCursor = 0;
      for (const e of entries) {
        prevCursor += packPreviousInstanceTransform(
          previousScratch,
          prevCursor,
          e.previousModel ?? e.model,
        );
      }
      do_not_optimize(batches);
      do_not_optimize(cursorFloats);
      do_not_optimize(prevCursor);
    });
  });
});
