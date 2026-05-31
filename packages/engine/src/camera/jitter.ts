import type { Entity } from '@retro-engine/ecs';
import { mat4 } from '@retro-engine/math';
import type { Mat4 } from '@retro-engine/math';

/**
 * A sub-pixel camera offset, in framebuffer pixels, requested for one camera
 * this frame. `{ x: 0.25, y: -0.5 }` shifts the rendered image a quarter pixel
 * right and half a pixel up. Magnitudes stay within roughly `[-0.5, 0.5]`.
 */
export interface JitterOffset {
  /** Horizontal offset in pixels. */
  readonly x: number;
  /** Vertical offset in pixels. */
  readonly y: number;
}

/**
 * Per-camera sub-pixel jitter offsets for the current frame, keyed by
 * main-world camera entity.
 *
 * This resource is pure mechanism: the camera plugin reads it in
 * `RenderSet.Prepare` and bakes the offset into the camera's `view_proj`
 * (leaving `unjittered_view_proj` clean), with no knowledge of *why* a camera
 * is jittering. Temporal anti-aliasing populates it in `RenderSet.Extract`;
 * absent that producer the map stays empty and every camera renders unjittered.
 *
 * Cleared and repopulated each frame by whichever system drives it — a camera
 * with no entry is rendered with `view_proj === unjittered_view_proj`.
 *
 * @internal
 */
export class ViewJitter {
  /** Per-source-entity pixel offset for this frame. */
  readonly perCamera: Map<Entity, JitterOffset> = new Map();
}

/**
 * Write a sub-pixel-jittered copy of `projection` into `out`.
 *
 * The offset is given in normalized-device-coordinate units (clip space after
 * the perspective divide). It is folded in as `offset * clip.w` added to
 * `clip.x` / `clip.y`, which is a constant NDC shift independent of depth — the
 * standard temporal-jitter trick. Adding it to the matrix rows that produce
 * `clip.w` makes this work for both perspective (`w = -z_view`) and orthographic
 * (`w = 1`) projections without a special case.
 *
 * Matrices are column-major (`element = column * 4 + row`); the projection's
 * fourth-row entries (`m[3]`, `m[7]`, `m[11]`, `m[15]`) are the per-column
 * contributors to `clip.w`.
 *
 * @param projection - Source projection matrix (left unchanged).
 * @param ndcX - Horizontal offset in NDC units.
 * @param ndcY - Vertical offset in NDC units.
 * @param out - Destination matrix; may not alias `projection`.
 * @returns `out`.
 */
export const jitterProjection = (projection: Mat4, ndcX: number, ndcY: number, out: Mat4): Mat4 => {
  mat4.copy(projection, out);
  for (let c = 0; c < 4; c++) {
    const w = projection[c * 4 + 3]!;
    out[c * 4 + 0] = projection[c * 4 + 0]! + ndcX * w;
    out[c * 4 + 1] = projection[c * 4 + 1]! + ndcY * w;
  }
  return out;
};
