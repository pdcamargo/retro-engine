import type { Entity } from '@retro-engine/ecs';

/** Floats per frustum captured in the snapshot: 6 planes × (normal.xyz + d). */
const FLOATS_PER_CAMERA = 24;

/**
 * Cross-frame state for the change-gated visibility cull.
 *
 * Holds a snapshot of last frame's active-camera culling inputs (each frustum's
 * six plane equations, plus the per-camera layer mask and the active count) so
 * the cull can detect when any camera moved, changed projection, or entered /
 * left the active set. Any difference forces a full recompute that frame; an
 * unchanged camera set lets the cull touch only the entities whose own inputs
 * changed. `dirty` is reused scratch so a steady frame allocates nothing.
 *
 * @internal
 */
export class CheckVisibilityState {
  /** Flattened plane coefficients for each active camera, `FLOATS_PER_CAMERA` apart. */
  lastPlanes = new Float32Array(0);
  /** Per-active-camera layer mask, parallel to {@link lastPlanes}. */
  lastLayerMasks = new Uint32Array(0);
  /** Active-camera count last frame; `-1` forces a full pass on the first frame. */
  lastActiveCount = -1;
  /** Reused dirty-entity scratch for the change-gated pass. */
  readonly dirty = new Set<Entity>();

  /** Grow the snapshot buffers to hold `count` cameras, preserving nothing. */
  ensureCapacity(count: number): void {
    if (this.lastPlanes.length < count * FLOATS_PER_CAMERA) {
      this.lastPlanes = new Float32Array(count * FLOATS_PER_CAMERA);
    }
    if (this.lastLayerMasks.length < count) {
      this.lastLayerMasks = new Uint32Array(count);
    }
  }
}

export { FLOATS_PER_CAMERA };
