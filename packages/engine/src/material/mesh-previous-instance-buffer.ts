import type { Buffer, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import { PREVIOUS_INSTANCE_BYTE_SIZE } from './instance-layout';

const MIN_CAPACITY = 64 as const;
const GROWTH_FACTOR = 1.5 as const;

/**
 * Sibling to `MeshInstanceBuffer` carrying the per-entity *previous*-frame
 * model matrix used by the motion-vector prepass to reconstruct the previous
 * clip-space position alongside the current.
 *
 * Lazy: the GPU buffer is allocated on the first `ensureCapacity` call,
 * which the material plugin only issues when an active camera carries the
 * `MotionVectorPrepass` marker and at least one opt-in material participates
 * in the motion-vector channel. Apps that never reach for motion vectors pay
 * nothing for this slot.
 *
 * Growth mirrors `MeshInstanceBuffer` (1.5× capacity bump, minimum
 * {@link MIN_CAPACITY} instances) so the two buffers grow in lockstep when
 * sized from the same renderable count. The prior buffer is held in
 * `pendingDestroy` for one frame after a resize before being destroyed for
 * the same WebGPU in-flight-submission reason that lives on the current-
 * frame sibling.
 *
 * @internal
 */
export class MeshPreviousInstanceBuffer {
  buffer: Buffer | undefined;
  /** Capacity in instances (each instance = {@link PREVIOUS_INSTANCE_BYTE_SIZE} bytes). */
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
    if (this.pendingDestroy !== undefined) {
      this.pendingDestroy.destroy();
      this.pendingDestroy = undefined;
    }
    if (required <= this.capacity && this.buffer !== undefined) return;
    let newCapacity = this.capacity > 0 ? this.capacity : MIN_CAPACITY;
    while (newCapacity < required) {
      newCapacity = Math.max(newCapacity + 1, Math.ceil(newCapacity * GROWTH_FACTOR));
    }
    const byteSize = newCapacity * PREVIOUS_INSTANCE_BYTE_SIZE;
    const fresh = renderer.createBuffer({
      label: 'mesh-previous-instance-buffer',
      size: byteSize,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    if (this.buffer !== undefined) this.pendingDestroy = this.buffer;
    this.buffer = fresh;
    this.capacity = newCapacity;
    const newFloatLen = newCapacity * (PREVIOUS_INSTANCE_BYTE_SIZE / 4);
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
