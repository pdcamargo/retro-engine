import type { Buffer, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import { TEXT_INSTANCE_BYTE_SIZE } from './text-glyph-instance';

const MIN_CAPACITY = 256 as const;
const GROWTH_FACTOR = 1.5 as const;

/**
 * Render-world resource owning the per-frame glyph instance buffer.
 *
 * One growable `BufferUsage.VERTEX | BufferUsage.COPY_DST` buffer plus a shared
 * scratch `Float32Array` (and an aliased `Uint32Array` for the packed colour
 * slot). The prepare system packs every visible glyph into the scratch then
 * issues one `renderer.writeBuffer` per frame. Growth mirrors
 * {@link import('../sprite/sprite-instance-buffer').SpriteInstanceBuffer}: 1.5×
 * bumps with a one-frame deferred destroy of the prior buffer (WebGPU disallows
 * destroying a buffer still referenced by an in-flight submission). Capacity is
 * counted in glyph instances — a single string contributes one per visible
 * glyph, so the minimum starts higher than the sprite buffer's.
 *
 * @internal
 */
export class TextInstanceBuffer {
  buffer: Buffer | undefined;
  /** Capacity in glyph instances (each = {@link TEXT_INSTANCE_BYTE_SIZE} bytes). */
  capacity = 0;
  /** Glyphs written this frame (resets to 0 at the start of every prepare pass). */
  count = 0;
  /** Holds the prior frame's buffer for one tick post-resize; destroyed at the next ensure. */
  pendingDestroy: Buffer | undefined;
  /** Shared scratch — sized in floats; grows alongside the GPU buffer. */
  scratchF32: Float32Array = new Float32Array(0);
  /** Aliased view of {@link scratchF32}'s underlying `ArrayBuffer` for packed-RGBA writes. */
  scratchU32: Uint32Array = new Uint32Array(0);

  /**
   * Guarantee at least `required` glyph slots of capacity, growing the buffer
   * (and scratch) when needed and deferring destroy of the prior buffer to the
   * next frame.
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
    const fresh = renderer.createBuffer({
      label: 'text-instance-buffer',
      size: newCapacity * TEXT_INSTANCE_BYTE_SIZE,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    if (this.buffer !== undefined) this.pendingDestroy = this.buffer;
    this.buffer = fresh;
    this.capacity = newCapacity;
    const newFloatLen = newCapacity * (TEXT_INSTANCE_BYTE_SIZE / 4);
    if (this.scratchF32.length < newFloatLen) {
      const backing = new ArrayBuffer(newFloatLen * 4);
      this.scratchF32 = new Float32Array(backing);
      this.scratchU32 = new Uint32Array(backing);
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
