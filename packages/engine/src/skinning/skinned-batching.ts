import type { Mat4 } from '@retro-engine/math';
import type {
  BindGroup,
  Buffer,
  RenderPassEncoder,
  RenderPipeline,
  Renderer,
} from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import type { RenderContext } from '../index';
import type { AllocatorSlice, RenderMesh } from '../mesh';
import type { AlphaBucket } from '../material/instance-batching';

import {
  SKINNED_INSTANCE_BYTE_SIZE,
  SKINNED_INSTANCE_FLOAT_COUNT,
  packSkinnedInstance,
} from './skinned-instance-layout';
import { SKINNED_PALETTE_GROUP } from './skinned-palette-gpu';

const BUCKET_RANK: Readonly<Record<AlphaBucket, number>> = { opaque: 0, mask: 1, blend: 2 };
const MIN_CAPACITY = 64;
const GROWTH_FACTOR = 1.5;

/**
 * Per-group draw data for a skinned instanced batch: the rigid payload fields
 * plus the shared joint-palette bind group bound at {@link SKINNED_PALETTE_GROUP},
 * and an optional group(3) bind group to restore afterward (a view's SSAO group,
 * which shares the slot — see ADR-0115).
 */
export interface SkinnedDrawPayload {
  readonly pipeline: RenderPipeline;
  readonly materialBindGroup: BindGroup;
  readonly paletteBindGroup: BindGroup;
  readonly vertexSlice: AllocatorSlice;
  readonly indexSlice: AllocatorSlice | undefined;
  readonly renderMesh: RenderMesh;
  readonly restoreGroup3?: BindGroup;
}

/** One skinned renderable before batching; `payload` is constant across a group. */
export interface SkinnedInstanceEntry {
  readonly cameraEntity: number;
  readonly bucket: AlphaBucket;
  readonly groupKey: string;
  readonly depth: number;
  readonly model: Mat4;
  /** Base matrix index into the shared palette buffer for this entity. */
  readonly jointOffset: number;
  readonly payload: SkinnedDrawPayload;
}

/** A run of skinned instances collapsed into one instanced draw. */
export interface SkinnedBatch {
  readonly cameraEntity: number;
  readonly bucket: AlphaBucket;
  readonly firstInstance: number;
  count: number;
  readonly sortDepth: number;
  readonly payload: SkinnedDrawPayload;
}

/**
 * Per-material-plugin growable buffer for skinned instances (model +
 * inverse-transpose + `joint_offset`). Mirrors `MeshInstanceBuffer` but with the
 * wider skinned stride and a paired `Float32Array` / `Uint32Array` view over one
 * scratch buffer so the transform and the integer offset pack together.
 */
export class SkinnedInstanceBuffer {
  buffer: Buffer | undefined;
  capacity = 0;
  count = 0;
  pendingDestroy: Buffer | undefined;
  private scratch = new ArrayBuffer(0);
  f32 = new Float32Array(this.scratch);
  u32 = new Uint32Array(this.scratch);

  ensureCapacity(renderer: Renderer, required: number): void {
    if (this.pendingDestroy !== undefined) {
      this.pendingDestroy.destroy();
      this.pendingDestroy = undefined;
    }
    if (required <= this.capacity && this.buffer !== undefined) return;
    let newCapacity = this.capacity > 0 ? this.capacity : MIN_CAPACITY;
    while (newCapacity < required) {
      newCapacity = Math.max(newCapacity + 1, Math.ceil(newCapacity * GROWTH_FACTOR));
    }
    const fresh = renderer.createBuffer({
      label: 'skinned-instance-buffer',
      size: newCapacity * SKINNED_INSTANCE_BYTE_SIZE,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    if (this.buffer !== undefined) this.pendingDestroy = this.buffer;
    this.buffer = fresh;
    this.capacity = newCapacity;
    const slots = newCapacity * SKINNED_INSTANCE_FLOAT_COUNT;
    if (this.f32.length < slots) {
      this.scratch = new ArrayBuffer(slots * 4);
      this.f32 = new Float32Array(this.scratch);
      this.u32 = new Uint32Array(this.scratch);
    }
  }

  dispose(): void {
    this.pendingDestroy?.destroy();
    this.pendingDestroy = undefined;
    this.buffer?.destroy();
    this.buffer = undefined;
    this.capacity = 0;
    this.count = 0;
  }
}

/**
 * Sort skinned `entries`, pack each instance into the paired scratch views, and
 * emit one batch per maximal run of identical `(cameraEntity, bucket, groupKey)`.
 * Same ordering contract as `packInstancedBatches`. Returns the batches and the
 * number of 4-byte slots written (for the single per-frame `writeBuffer`).
 */
export const packSkinnedBatches = (
  entries: SkinnedInstanceEntry[],
  depthOrdered: ReadonlySet<AlphaBucket>,
  f32: Float32Array,
  u32: Uint32Array,
): { batches: SkinnedBatch[]; cursorSlots: number } => {
  entries.sort((a, b) => {
    if (a.cameraEntity !== b.cameraEntity) return a.cameraEntity - b.cameraEntity;
    const ra = BUCKET_RANK[a.bucket];
    const rb = BUCKET_RANK[b.bucket];
    if (ra !== rb) return ra - rb;
    if (depthOrdered.has(a.bucket) && a.depth !== b.depth) return b.depth - a.depth;
    return a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : 0;
  });

  const batches: SkinnedBatch[] = [];
  let cursorSlots = 0;
  let cursorInstances = 0;
  let cur: SkinnedBatch | undefined;
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
    cursorSlots += packSkinnedInstance(f32, u32, cursorSlots, e.model, e.jointOffset);
    cur.count += 1;
    cursorInstances += 1;
  }
  return { batches, cursorSlots };
};

/**
 * Build the draw closure for one skinned instanced batch: view(0) and lights(2)
 * are bound by the pass node, group(1) is the material, the joint palette is
 * bound at {@link SKINNED_PALETTE_GROUP}, and the per-instance transform +
 * `joint_offset` ride in vertex slot 1. When a view bound an SSAO group at the
 * palette's slot, it is restored after the draw so other draws in the pass keep
 * working (skinning and SSAO are otherwise mutually exclusive — ADR-0115).
 */
export const makeSkinnedDraw =
  (payload: SkinnedDrawPayload, instanceBuffer: Buffer, firstInstance: number, count: number) =>
  (pass: RenderPassEncoder, _ctx: RenderContext): void => {
    pass.setPipeline(payload.pipeline);
    pass.setBindGroup(1, payload.materialBindGroup);
    pass.setBindGroup(SKINNED_PALETTE_GROUP, payload.paletteBindGroup);
    pass.setVertexBuffer(0, payload.vertexSlice.buffer);
    pass.setVertexBuffer(1, instanceBuffer);
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
    if (payload.restoreGroup3 !== undefined) {
      pass.setBindGroup(SKINNED_PALETTE_GROUP, payload.restoreGroup3);
    }
  };
