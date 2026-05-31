/**
 * Per-camera component opting that camera into screen-space motion blur on the
 * rendered HDR scene, driven by the motion-vector prepass.
 *
 * Honored only when the camera also has `hdr: true` (motion blur reads the HDR
 * intermediate the geometry passes write — a non-HDR camera writes straight to
 * its final target, which is not sampleable) **and** a `MotionVectorPrepass`
 * component (so a motion-vector target exists to sample velocity from). When
 * either prerequisite is missing the blur is skipped and the camera renders
 * normally; a one-time dev warning explains which prerequisite was absent.
 *
 * Per-camera (not a global resource) so a multi-camera scene can blur the
 * gameplay camera while leaving a HUD camera sharp.
 *
 * @example
 * ```ts
 * import { Camera3d, MotionBlur, MotionVectorPrepass, DepthPrepass } from '@retro-engine/engine';
 * cmd.spawn(
 *   ...Camera3d({ hdr: true }),
 *   new DepthPrepass(),
 *   new MotionVectorPrepass(),
 *   new MotionBlur({ shutterAngle: 0.5 }),
 * );
 * ```
 */
export class MotionBlur {
  /** Number of samples taken along the per-pixel velocity vector. Clamped to `[1, 32]` in the shader. */
  samples: number;
  /** Scalar applied to the sampled velocity. `1` blurs over the full reconstructed motion; `0` disables. */
  intensity: number;
  /**
   * Fraction of the frame interval the virtual shutter is open, `0..1`. `0.5`
   * mirrors a 180° physical shutter (the common film convention). Multiplies
   * the velocity alongside {@link intensity}.
   */
  shutterAngle: number;
  /**
   * Upper bound on the per-pixel sample displacement, in UV units (fraction of
   * the screen). Caps the smear when the motion target carries a large
   * frame-to-frame delta (a camera cut, a teleport).
   */
  maxVelocity: number;

  constructor(options: {
    samples?: number;
    intensity?: number;
    shutterAngle?: number;
    maxVelocity?: number;
  } = {}) {
    this.samples = options.samples ?? 8;
    this.intensity = options.intensity ?? 1.0;
    this.shutterAngle = options.shutterAngle ?? 0.5;
    this.maxVelocity = options.maxVelocity ?? 0.1;
  }
}

/**
 * Default motion-blur settings the camera bundle factories clone when a camera
 * opts into motion blur without overriding any field.
 */
export const DEFAULT_MOTION_BLUR: Readonly<MotionBlur> = Object.freeze(new MotionBlur());
