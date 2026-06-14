import type { Buffer, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import { GIZMO_VERTEX_STRIDE } from './gizmo-layers';

const MIN_VERTICES = 256 as const;
const GROWTH_FACTOR = 1.5 as const;

/**
 * Growable per-frame vertex buffer for gizmo lines.
 *
 * One `BufferUsage.VERTEX | BufferUsage.COPY_DST` buffer plus a shared scratch
 * `Float32Array` packed each frame and uploaded with a single
 * `renderer.writeBuffer`. Growth follows the engine's instance-buffer
 * precedent: 1.5× capacity bumps, minimum {@link MIN_VERTICES} vertices, and the
 * prior buffer held in `pendingDestroy` for one frame after a resize — WebGPU
 * forbids destroying a buffer still referenced by an in-flight submission.
 *
 * @internal
 */
export class GizmoBufferGpu {
  buffer: Buffer | undefined;
  /** Capacity in vertices (each vertex = {@link GIZMO_VERTEX_STRIDE} bytes). */
  capacity = 0;
  /** Holds the prior frame's buffer for one tick post-resize. */
  pendingDestroy: Buffer | undefined;
  /** Shared scratch sized in floats; grows alongside the GPU buffer. */
  scratchF32: Float32Array = new Float32Array(0);

  /** Guarantee `required` vertex slots, growing (and deferring destroy) as needed. */
  ensureCapacity(renderer: Renderer, required: number): void {
    if (this.pendingDestroy !== undefined) {
      this.pendingDestroy.destroy();
      this.pendingDestroy = undefined;
    }
    if (required <= this.capacity && this.buffer !== undefined) return;
    let newCapacity = this.capacity > 0 ? this.capacity : MIN_VERTICES;
    while (newCapacity < required) {
      newCapacity = Math.max(newCapacity + 1, Math.ceil(newCapacity * GROWTH_FACTOR));
    }
    const fresh = renderer.createBuffer({
      label: 'gizmo-line-buffer',
      size: newCapacity * GIZMO_VERTEX_STRIDE,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    if (this.buffer !== undefined) this.pendingDestroy = this.buffer;
    this.buffer = fresh;
    this.capacity = newCapacity;
    const floatLen = newCapacity * (GIZMO_VERTEX_STRIDE / 4);
    if (this.scratchF32.length < floatLen) this.scratchF32 = new Float32Array(floatLen);
  }

  /** Drop the GPU buffer and any pending-destroy slot. Called on plugin teardown. */
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
  }
}
