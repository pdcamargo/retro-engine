import type { Entity } from '@retro-engine/ecs';

/**
 * Resolved per-camera motion-blur parameters for one frame, as consumed by the
 * shader. `velocityScale` folds {@link MotionBlur.intensity} and
 * {@link MotionBlur.shutterAngle} into the single multiplier the WGSL applies.
 *
 * @internal
 */
export interface MotionBlurParams {
  readonly samples: number;
  readonly velocityScale: number;
  readonly maxVelocity: number;
}

/**
 * Render-world resource carrying one frame's snapshot of every active camera's
 * motion-blur parameters. Populated in `RenderSet.Extract`; read by the
 * prepare system (to write the params uniform) and the node (to decide whether
 * to run). Keyed by main-world camera `sourceEntity`.
 *
 * Cleared and repopulated each frame — a camera absent from the current frame's
 * query simply has no entry, so the pass skips it.
 *
 * @internal
 */
export class ViewMotionBlur {
  readonly byCamera: Map<Entity, MotionBlurParams> = new Map();
}
