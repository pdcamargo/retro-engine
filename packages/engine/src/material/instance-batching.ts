import type { Mat4 } from '@retro-engine/math';
import type { BindGroup, Buffer, RenderPassEncoder, RenderPipeline } from '@retro-engine/renderer-core';

import type { RenderContext } from '../index';
import type { AllocatorSlice, RenderMesh } from '../mesh';

import { packInstanceTransform } from './instance-layout';

/** Which render phase an instanced batch belongs to. */
export type AlphaBucket = 'opaque' | 'mask' | 'blend';

const BUCKET_RANK: Readonly<Record<AlphaBucket, number>> = { opaque: 0, mask: 1, blend: 2 };

/**
 * Per-group draw data shared by every instance in a batch — everything the
 * instanced draw needs except the instance-buffer slice (`firstInstance` /
 * `count`, supplied by the batch). Identical for 3D and 2D material draws.
 */
export interface InstancedDrawPayload {
  readonly pipeline: RenderPipeline;
  readonly materialBindGroup: BindGroup;
  readonly vertexSlice: AllocatorSlice;
  readonly indexSlice: AllocatorSlice | undefined;
  readonly renderMesh: RenderMesh;
  /**
   * Second per-instance vertex buffer, bound at slot 2, carrying each
   * entity's previous-frame model matrix. Populated only on payloads whose
   * pipeline is a motion-vector prepass variant — main-pass opaque /
   * transparent draws and non-motion prepass variants leave this undefined
   * and slot 2 unbound.
   */
  readonly previousInstanceBuffer?: Buffer;
}

/** One renderable, before batching. `payload` is constant across a group. */
export interface InstanceEntry {
  /** Camera/view the instance is drawn for; batches never span cameras. */
  readonly cameraEntity: number;
  readonly bucket: AlphaBucket;
  /** Identity instances must share to batch — the `(mesh, material)` pair. */
  readonly groupKey: string;
  /** Camera-space sort depth. */
  readonly depth: number;
  readonly model: Mat4;
  readonly payload: InstancedDrawPayload;
  /**
   * Previous-frame model matrix used by the motion-vector prepass. Populated
   * by the material plugin only when at least one active camera has the
   * `MotionVectorPrepass` marker; otherwise the previous-instance vertex
   * buffer is not built and this field stays undefined.
   */
  readonly previousModel?: Mat4;
}

/** A run of instances collapsed into one instanced draw. */
export interface InstancedBatch {
  readonly cameraEntity: number;
  readonly bucket: AlphaBucket;
  readonly firstInstance: number;
  count: number;
  readonly sortDepth: number;
  readonly payload: InstancedDrawPayload;
}

/**
 * Sort `entries`, pack each instance's transform into `scratch`, and emit one
 * batch per maximal run of identical `(cameraEntity, bucket, groupKey)`.
 *
 * Buckets in `depthOrdered` are sorted back-to-front (descending depth) before
 * grouping, so a run only merges instances that no other group interleaves in
 * depth — preserving draw order where it matters (transparent 3D; all 2D, which
 * has no depth buffer). Other buckets group by key regardless of depth for
 * maximal instancing (opaque / alpha-mask 3D, resolved by the depth buffer).
 *
 * Returns the batches in emission order and the float count written to
 * `scratch` (for the single per-frame `writeBuffer`). Each batch's `sortDepth`
 * is its first (back-most, for depth-ordered buckets) entry's depth, so the
 * pass node's re-sort reproduces this order.
 */
export const packInstancedBatches = (
  entries: InstanceEntry[],
  depthOrdered: ReadonlySet<AlphaBucket>,
  scratch: Float32Array,
): { batches: InstancedBatch[]; cursorFloats: number } => {
  entries.sort((a, b) => {
    if (a.cameraEntity !== b.cameraEntity) return a.cameraEntity - b.cameraEntity;
    const ra = BUCKET_RANK[a.bucket];
    const rb = BUCKET_RANK[b.bucket];
    if (ra !== rb) return ra - rb;
    if (depthOrdered.has(a.bucket) && a.depth !== b.depth) return b.depth - a.depth;
    return a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : 0;
  });

  const batches: InstancedBatch[] = [];
  let cursorFloats = 0;
  let cursorInstances = 0;
  let cur: InstancedBatch | undefined;
  let curKey: string | undefined;
  for (const e of entries) {
    if (
      cur === undefined ||
      cur.cameraEntity !== e.cameraEntity ||
      cur.bucket !== e.bucket ||
      curKey !== e.groupKey
    ) {
      cur = {
        cameraEntity: e.cameraEntity,
        bucket: e.bucket,
        firstInstance: cursorInstances,
        count: 0,
        sortDepth: e.depth,
        payload: e.payload,
      };
      batches.push(cur);
      curKey = e.groupKey;
    }
    cursorFloats += packInstanceTransform(scratch, cursorFloats, e.model);
    cur.count += 1;
    cursorInstances += 1;
  }
  return { batches, cursorFloats };
};

/**
 * Build the draw closure for one instanced batch. Shared by the 3D and 2D
 * material plugins — `@group(0)` view is bound by the pass node, `@group(1)` is
 * the material, the per-instance transform rides in vertex buffer slot 1, and
 * the previous-frame transform (when the pipeline opts into the motion-vector
 * prepass via {@link InstancedDrawPayload.previousInstanceBuffer}) rides in
 * slot 2.
 */
export const makeInstancedDraw =
  (
    payload: InstancedDrawPayload,
    instanceBuffer: Buffer,
    firstInstance: number,
    count: number,
  ) =>
  (pass: RenderPassEncoder, _ctx: RenderContext): void => {
    pass.setPipeline(payload.pipeline);
    pass.setBindGroup(1, payload.materialBindGroup);
    // Slab-allocated meshes share one vertex / index buffer; the slot is picked
    // via `baseVertex` (added to every index read) and `firstIndex`, so the
    // whole slab is bound at offset 0.
    pass.setVertexBuffer(0, payload.vertexSlice.buffer);
    pass.setVertexBuffer(1, instanceBuffer);
    if (payload.previousInstanceBuffer !== undefined) {
      pass.setVertexBuffer(2, payload.previousInstanceBuffer);
    }
    const rm = payload.renderMesh;
    if (rm.bufferInfo.kind === 'indexed') {
      const idx = payload.indexSlice!;
      pass.setIndexBuffer(idx.buffer, rm.bufferInfo.indexFormat);
      pass.drawIndexed(
        rm.bufferInfo.indexCount,
        count,
        idx.baseVertex,
        payload.vertexSlice.baseVertex,
        firstInstance,
      );
    } else {
      pass.draw(rm.vertexCount, count, payload.vertexSlice.baseVertex, firstInstance);
    }
  };
