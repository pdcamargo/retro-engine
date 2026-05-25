import type { Buffer, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import { SPRITE_INSTANCE_BYTE_SIZE } from './sprite-batch';

const MIN_CAPACITY = 64 as const;
const GROWTH_FACTOR = 1.5 as const;

/**
 * Render-world resource owning the per-frame sprite instance buffer.
 *
 * One growable `BufferUsage.VERTEX | BufferUsage.COPY_DST` buffer plus a
 * shared scratch `Float32Array` (and an aliased `Uint32Array` for the packed
 * colour slot). The prepare system packs every visible sprite into the
 * scratch then issues one `renderer.writeBuffer` per frame.
 *
 * Growth follows the {@link MeshAllocator} precedent: 1.5× capacity bump,
 * minimum {@link MIN_CAPACITY} sprites. The previous buffer is held in
 * `pendingDestroy` for one frame after a resize before being destroyed —
 * WebGPU disallows destroying a buffer that is still in-flight, and the
 * scheduler hasn't released the prior frame's submission by the time prepare
 * runs the next frame.
 *
 * @internal
 */
export class SpriteInstanceBuffer {
  buffer: Buffer | undefined;
  /** Capacity in sprite instances (each instance = {@link SPRITE_INSTANCE_BYTE_SIZE} bytes). */
  capacity = 0;
  /** Sprites written this frame (resets to 0 at the start of every prepare pass). */
  count = 0;
  /** Holds the prior frame's buffer for one tick post-resize; destroyed at the next ensure. */
  pendingDestroy: Buffer | undefined;
  /** Shared scratch — sized in floats; grows alongside the GPU buffer. */
  scratchF32: Float32Array = new Float32Array(0);
  /** Aliased view of {@link scratchF32}'s underlying `ArrayBuffer` for packed-RGBA writes. */
  scratchU32: Uint32Array = new Uint32Array(0);

  /**
   * Guarantee at least `required` sprite slots of capacity. Grows the buffer
   * (and scratch) when needed, defers destroy of the prior buffer to the next
   * frame, and returns nothing — the caller uses the now-populated
   * {@link buffer} / {@link scratchF32} / {@link scratchU32}.
   */
  ensureCapacity(renderer: Renderer, required: number): void {
    // Reap the prior frame's deferred-destroy candidate now that one more
    // frame has elapsed since it was retired.
    if (this.pendingDestroy !== undefined) {
      this.pendingDestroy.destroy();
      this.pendingDestroy = undefined;
    }
    if (required <= this.capacity && this.buffer !== undefined) return;
    let newCapacity = this.capacity > 0 ? this.capacity : MIN_CAPACITY;
    while (newCapacity < required) {
      newCapacity = Math.max(newCapacity + 1, Math.ceil(newCapacity * GROWTH_FACTOR));
    }
    const byteSize = newCapacity * SPRITE_INSTANCE_BYTE_SIZE;
    const fresh = renderer.createBuffer({
      label: 'sprite-instance-buffer',
      size: byteSize,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    // Quarantine the old buffer for one frame; destroying it here would
    // produce a WebGPU validation error on the prior frame's still-pending
    // submission.
    if (this.buffer !== undefined) this.pendingDestroy = this.buffer;
    this.buffer = fresh;
    this.capacity = newCapacity;
    // Resize scratch storage too — sized in floats (each instance = 11 floats).
    const newFloatLen = newCapacity * (SPRITE_INSTANCE_BYTE_SIZE / 4);
    if (this.scratchF32.length < newFloatLen) {
      const newScratchBuffer = new ArrayBuffer(newFloatLen * 4);
      this.scratchF32 = new Float32Array(newScratchBuffer);
      this.scratchU32 = new Uint32Array(newScratchBuffer);
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
