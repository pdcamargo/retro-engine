import type { BindGroup, Buffer, RenderPassEncoder, RenderPipeline, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import type { RenderContext } from '../index';
import type { AllocatorSlice, RenderMesh } from '../mesh';
import { MESH_INSTANCE_BYTE_SIZE, MESH_INSTANCE_FLOAT_COUNT } from '../material/instance-layout';
import { MORPH_GROUP } from './morph-gpu';

const MIN_CAPACITY = 16;
const GROWTH_FACTOR = 1.5;

/**
 * Per-draw data for one morphed renderable: the rigid payload fields plus the
 * per-entity morph bind group bound at {@link MORPH_GROUP}, and an optional
 * group(3) bind group to restore afterward (a view's SSAO group, which shares
 * the slot).
 */
export interface MorphedDrawPayload {
  readonly pipeline: RenderPipeline;
  readonly materialBindGroup: BindGroup;
  readonly morphBindGroup: BindGroup;
  readonly vertexSlice: AllocatorSlice;
  readonly indexSlice: AllocatorSlice | undefined;
  readonly renderMesh: RenderMesh;
  readonly restoreGroup3?: BindGroup;
}

/**
 * Growable per-frame instance buffer for morphed draws. Each morphed entity is a
 * single instance (morphed meshes are unique, not instance-batched), packed with
 * the rigid transform layout (model + inverse-transpose); each draw selects its
 * slot via `firstInstance`.
 */
export class MorphInstanceBuffer {
  buffer: Buffer | undefined;
  capacity = 0;
  pendingDestroy: Buffer | undefined;
  private scratch = new ArrayBuffer(0);
  f32 = new Float32Array(this.scratch);

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
      label: 'morph-instance-buffer',
      size: newCapacity * MESH_INSTANCE_BYTE_SIZE,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    if (this.buffer !== undefined) this.pendingDestroy = this.buffer;
    this.buffer = fresh;
    this.capacity = newCapacity;
    const slots = newCapacity * MESH_INSTANCE_FLOAT_COUNT;
    if (this.f32.length < slots) {
      this.scratch = new ArrayBuffer(slots * 4);
      this.f32 = new Float32Array(this.scratch);
    }
  }

  dispose(): void {
    this.pendingDestroy?.destroy();
    this.pendingDestroy = undefined;
    this.buffer?.destroy();
    this.buffer = undefined;
    this.capacity = 0;
  }
}

/**
 * Build the draw closure for one morphed entity: bind its material + morph
 * groups, the shared mesh + instance buffers, and issue a single-instance draw
 * at `firstInstance`. Restores a borrowed group(3) (SSAO) afterward when present.
 */
export const makeMorphedDraw =
  (payload: MorphedDrawPayload, instanceBuffer: Buffer, firstInstance: number) =>
  (pass: RenderPassEncoder, _ctx: RenderContext): void => {
    pass.setPipeline(payload.pipeline);
    pass.setBindGroup(1, payload.materialBindGroup);
    pass.setBindGroup(MORPH_GROUP, payload.morphBindGroup);
    pass.setVertexBuffer(0, payload.vertexSlice.buffer);
    pass.setVertexBuffer(1, instanceBuffer);
    const rm = payload.renderMesh;
    if (rm.bufferInfo.kind === 'indexed') {
      const idx = payload.indexSlice!;
      pass.setIndexBuffer(idx.buffer, rm.bufferInfo.indexFormat);
      pass.drawIndexed(rm.bufferInfo.indexCount, 1, idx.baseVertex, payload.vertexSlice.baseVertex, firstInstance);
    } else {
      pass.draw(rm.vertexCount, 1, payload.vertexSlice.baseVertex, firstInstance);
    }
    if (payload.restoreGroup3 !== undefined) {
      pass.setBindGroup(MORPH_GROUP, payload.restoreGroup3);
    }
  };
