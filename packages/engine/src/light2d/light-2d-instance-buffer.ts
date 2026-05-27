import type { Buffer, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import { LIGHT2D_INSTANCE_BYTE_SIZE } from './light-2d-batch';

const MIN_CAPACITY = 64 as const;
const GROWTH_FACTOR = 1.5 as const;

/**
 * Render-world resource owning the per-frame 2D-light instance buffer.
 *
 * One growable `BufferUsage.VERTEX | BufferUsage.COPY_DST` buffer plus a
 * shared scratch `Float32Array`. The queue system packs every visible 2D light
 * into the scratch ({@link LIGHT2D_INSTANCE_BYTE_SIZE} bytes per light) and
 * issues one `renderer.writeBuffer` per frame.
 *
 * Mirrors the {@link SpriteInstanceBuffer} growth pattern byte-for-byte: 1.5×
 * capacity bumps, minimum {@link MIN_CAPACITY} lights, prior buffer held in
 * `pendingDestroy` for one tick post-resize so WebGPU validation does not
 * reject the destroy on a still-in-flight submission.
 *
 * @internal
 */
export class Light2dInstanceBuffer {
  buffer: Buffer | undefined;
  /** Capacity in light instances (each instance = {@link LIGHT2D_INSTANCE_BYTE_SIZE} bytes). */
  capacity = 0;
  /** Lights written this frame (resets to 0 at the start of every queue pass). */
  count = 0;
  /** Holds the prior frame's buffer for one tick post-resize; destroyed at the next ensure. */
  pendingDestroy: Buffer | undefined;
  /** Shared scratch — sized in floats; grows alongside the GPU buffer. */
  scratchF32: Float32Array = new Float32Array(0);

  /**
   * Guarantee at least `required` light slots of capacity. Grows the buffer
   * (and scratch) when needed; defers destroy of the prior buffer to the next
   * frame.
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
    const byteSize = newCapacity * LIGHT2D_INSTANCE_BYTE_SIZE;
    const fresh = renderer.createBuffer({
      label: 'light2d-instance-buffer',
      size: byteSize,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    if (this.buffer !== undefined) this.pendingDestroy = this.buffer;
    this.buffer = fresh;
    this.capacity = newCapacity;
    const newFloatLen = newCapacity * (LIGHT2D_INSTANCE_BYTE_SIZE / 4);
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
