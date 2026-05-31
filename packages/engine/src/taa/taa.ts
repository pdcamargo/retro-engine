/**
 * Per-camera component opting that camera into temporal anti-aliasing (TAA).
 *
 * TAA jitters the camera by a sub-pixel amount each frame and blends the
 * current frame against a reprojected accumulation of prior frames, converging
 * toward a supersampled image along edges. It requires the same prerequisites
 * as the other HDR post passes: `hdr: true` (the resolve reads the HDR scene
 * intermediate, which is the only sampleable copy of the rendered frame) and a
 * `MotionVectorPrepass` (the resolve reprojects history along per-pixel
 * velocity). When either is missing the resolve is skipped and the camera
 * renders without temporal AA; a one-time dev warning explains which
 * prerequisite was absent.
 *
 * Per-camera (not a global resource) so a multi-camera scene can anti-alias the
 * gameplay camera while leaving a pixel-art HUD camera untouched.
 *
 * @example
 * ```ts
 * import { Camera3d, Taa, MotionVectorPrepass, DepthPrepass } from '@retro-engine/engine';
 * cmd.spawn(
 *   ...Camera3d({ hdr: true }),
 *   new DepthPrepass(),
 *   new MotionVectorPrepass(),
 *   new Taa(),
 * );
 * ```
 */
export class Taa {
  /**
   * History blend weight toward the current frame, `0..1`. Lower values keep
   * more history (smoother, but slower to react and more prone to ghosting);
   * higher values favor the current frame (sharper, but noisier). `0.1` is a
   * common default.
   */
  blend: number;

  constructor(options: { blend?: number } = {}) {
    this.blend = options.blend ?? 0.1;
  }
}

/**
 * Default TAA settings the camera bundle factories clone when a camera opts
 * into temporal anti-aliasing without overriding any field.
 */
export const DEFAULT_TAA: Readonly<Taa> = Object.freeze(new Taa());
