import type { Buffer, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import { TEXT3D_INSTANCE_BYTE_SIZE } from './text-glyph-instance-3d';

const MIN_CAPACITY = 256 as const;
const GROWTH_FACTOR = 1.5 as const;

/**
 * Render-world resource owning the per-frame world-space glyph instance buffer.
 * Mirrors {@link import('./text-instance-buffer').TextInstanceBuffer} but sized
 * for the larger 68-byte 3D instance ({@link TEXT3D_INSTANCE_BYTE_SIZE}).
 *
 * @internal
 */
export class Text3dInstanceBuffer {
  buffer: Buffer | undefined;
  /** Capacity in glyph instances (each = {@link TEXT3D_INSTANCE_BYTE_SIZE} bytes). */
  capacity = 0;
  /** Glyphs written this frame (resets to 0 at the start of every prepare pass). */
  count = 0;
  /** Holds the prior frame's buffer for one tick post-resize; destroyed at the next ensure. */
  pendingDestroy: Buffer | undefined;
  /** Shared scratch — sized in floats; grows alongside the GPU buffer. */
  scratchF32: Float32Array = new Float32Array(0);
  /** Aliased view of {@link scratchF32}'s buffer for packed-RGBA writes. */
  scratchU32: Uint32Array = new Uint32Array(0);

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
      label: 'text3d-instance-buffer',
      size: newCapacity * TEXT3D_INSTANCE_BYTE_SIZE,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    if (this.buffer !== undefined) this.pendingDestroy = this.buffer;
    this.buffer = fresh;
    this.capacity = newCapacity;
    const newFloatLen = newCapacity * (TEXT3D_INSTANCE_BYTE_SIZE / 4);
    if (this.scratchF32.length < newFloatLen) {
      const backing = new ArrayBuffer(newFloatLen * 4);
      this.scratchF32 = new Float32Array(backing);
      this.scratchU32 = new Uint32Array(backing);
    }
  }

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
