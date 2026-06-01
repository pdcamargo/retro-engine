/**
 * Per-camera component opting that camera into screen-space ambient occlusion
 * (SSAO) using a ground-truth ambient-occlusion (GTAO) horizon-search pass.
 *
 * AO darkens the **ambient / indirect** lighting term in creases, contact
 * points, and concavities the analytic lights leave flat. It runs before the
 * opaque pass: a full-screen pass reads the depth + normal prepass, computes an
 * occlusion factor per pixel, and the lit forward shader multiplies that factor
 * into its ambient term (alongside the material's own occlusion texture). It
 * does **not** darken direct light.
 *
 * Honored only when the camera also carries a {@link DepthPrepass} and a
 * {@link NormalPrepass} (AO reconstructs view-space position from depth and
 * reads the world-space normal). When either is missing the pass is skipped and
 * the camera shades with a flat ambient term; a one-time dev warning explains
 * which prerequisite was absent. AO does not require `Camera.hdr` — it runs
 * before any HDR intermediate exists.
 *
 * Per-camera (not a global resource) so a multi-camera scene can occlude the
 * gameplay camera while leaving a stylized camera flat.
 *
 * @example
 * ```ts
 * import { Camera3d, ScreenSpaceAo, DepthPrepass, NormalPrepass } from '@retro-engine/engine';
 * cmd.spawn(
 *   ...Camera3d({ hdr: true }),
 *   new DepthPrepass(),
 *   new NormalPrepass(),
 *   new ScreenSpaceAo({ radius: 0.5, intensity: 1.0 }),
 * );
 * ```
 */
export class ScreenSpaceAo {
  /**
   * Sampling radius in view-space units (world units at the sampled surface).
   * The horizon search only counts occluders within this distance, so larger
   * values darken broader concavities at the cost of wider sampling.
   */
  radius: number;
  /**
   * Occlusion strength. Applied as an exponent on the visibility term, so `1`
   * is physically neutral, values `> 1` deepen the darkening, and `0` disables.
   */
  intensity: number;
  /**
   * Horizon angle bias in radians, rejecting near-coplanar samples that would
   * otherwise self-occlude flat surfaces into false darkening. Raise to remove
   * banding on low-poly geometry.
   */
  bias: number;
  /** Number of horizon-search directions (slices) per pixel. Clamped to `[1, 8]` in the shader. */
  slices: number;
  /** Number of march steps along each direction. Clamped to `[1, 16]` in the shader. */
  steps: number;

  constructor(
    options: {
      radius?: number;
      intensity?: number;
      bias?: number;
      slices?: number;
      steps?: number;
    } = {},
  ) {
    this.radius = options.radius ?? 0.5;
    this.intensity = options.intensity ?? 1.0;
    this.bias = options.bias ?? 0.1;
    this.slices = options.slices ?? 2;
    this.steps = options.steps ?? 8;
  }
}

/**
 * Default ambient-occlusion settings cloned when a camera opts into SSAO
 * without overriding any field.
 */
export const DEFAULT_AO: Readonly<ScreenSpaceAo> = Object.freeze(new ScreenSpaceAo());
