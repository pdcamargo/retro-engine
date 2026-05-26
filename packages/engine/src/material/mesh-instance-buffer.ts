import type { Buffer, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import { MESH_INSTANCE_BYTE_SIZE } from './instance-layout';

const MIN_CAPACITY = 64 as const;
const GROWTH_FACTOR = 1.5 as const;

/**
 * Per-material-plugin resource owning the per-frame mesh instance buffer.
 *
 * One growable `BufferUsage.VERTEX | BufferUsage.COPY_DST` buffer plus a shared
 * scratch `Float32Array`. The queue system packs every visible instance's
 * transform into the scratch (see `packInstanceTransform`) then issues one
 * `renderer.writeBuffer` per frame, and instanced draws index into it via
 * `firstInstance`.
 *
 * Growth follows the sprite-instance-buffer precedent: 1.5× capacity bump,
 * minimum {@link MIN_CAPACITY} instances. The previous buffer is held in
 * `pendingDestroy` for one frame after a resize before being destroyed —
 * WebGPU disallows destroying a buffer still referenced by an in-flight
 * submission, and the prior frame's submission has not been released by the
 * time the next frame's queue runs.
 *
 * @internal
 */
export class MeshInstanceBuffer {
  buffer: Buffer | undefined;
  /** Capacity in instances (each instance = {@link MESH_INSTANCE_BYTE_SIZE} bytes). */
  capacity = 0;
  /** Instances written this frame (reset to 0 at the start of every queue pass). */
  count = 0;
  /** Holds the prior frame's buffer for one tick post-resize; destroyed at the next ensure. */
  pendingDestroy: Buffer | undefined;
  /** Shared scratch — sized in floats; grows alongside the GPU buffer. */
  scratchF32: Float32Array = new Float32Array(0);

  /**
   * Guarantee at least `required` instance slots of capacity. Grows the buffer
   * (and scratch) when needed and defers destroy of the prior buffer to the
   * next frame. The caller then packs into {@link scratchF32} and uploads via
   * {@link buffer}.
   */
  ensureCapacity(renderer: Renderer, required: number): void {
    // Reap the prior frame's deferred-destroy candidate now that one more frame
    // has elapsed since it was retired.
    if (this.pendingDestroy !== undefined) {
      this.pendingDestroy.destroy();
      this.pendingDestroy = undefined;
    }
    if (required <= this.capacity && this.buffer !== undefined) return;
    let newCapacity = this.capacity > 0 ? this.capacity : MIN_CAPACITY;
    while (newCapacity < required) {
      newCapacity = Math.max(newCapacity + 1, Math.ceil(newCapacity * GROWTH_FACTOR));
    }
    const byteSize = newCapacity * MESH_INSTANCE_BYTE_SIZE;
    const fresh = renderer.createBuffer({
      label: 'mesh-instance-buffer',
      size: byteSize,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    if (this.buffer !== undefined) this.pendingDestroy = this.buffer;
    this.buffer = fresh;
    this.capacity = newCapacity;
    const newFloatLen = newCapacity * (MESH_INSTANCE_BYTE_SIZE / 4);
    if (this.scratchF32.length < newFloatLen) {
      this.scratchF32 = new Float32Array(newFloatLen);
    }
  }

  /** Drop the GPU buffer + any pending-destroy slot. Called on plugin teardown. */
  dispose(): void {
    if (this.pendingDestroy !== undefined) {
      this.pendingDestroy.destroy();
      this.pendingDestroy = undefined;
    }
    if (this.buffer !== undefined) {
      this.buffer.destroy();
      this.buffer = undefined;
    }
    this.capacity = 0;
    this.count = 0;
  }
}
