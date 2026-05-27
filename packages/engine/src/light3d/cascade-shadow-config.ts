/**
 * Number of cascades a directional light's shadow can be split into. Bounded by
 * the single `vec4<f32>` of cascade split distances uploaded to the GPU, so a
 * directional light occupies at most this many shadow-atlas layers.
 */
export const MAX_CASCADES = 4 as const;

/**
 * Options accepted by the {@link CascadeShadowConfig} constructor. Every field
 * is optional; omitted fields take the documented default.
 */
export interface CascadeShadowConfigOptions {
  /**
   * How many cascades to split the directional shadow into, clamped to
   * `[1, ${MAX_CASCADES}]`. More cascades trade shadow-atlas layers for crisper
   * shadows across a wider depth range. Default `4`.
   */
  numCascades?: number;
  /**
   * View-space distance (world units from the camera) of the near edge of the
   * first cascade. Geometry closer than this is not covered by a cascade.
   * Default `0.1`.
   */
  minimumDistance?: number;
  /**
   * View-space distance of the far edge of the last cascade — the shadow draw
   * distance. Beyond it, geometry is unshadowed. Smaller values pack more
   * resolution into the visible range. Default `150`.
   */
  maximumDistance?: number;
  /**
   * Optional override for the far edge of the first cascade (view-space
   * distance), clamped between {@link minimumDistance} and the second cascade's
   * far edge. Lets you tighten the highest-resolution cascade around nearby
   * geometry. Default: derived from the split scheme.
   */
  firstCascadeFarBound?: number;
  /**
   * Fraction `[0, 1]` of each cascade's range over which it blends into the next,
   * softening the seam where the active cascade switches. Default `0.2`.
   */
  overlapProportion?: number;
  /**
   * Blend `[0, 1]` between a uniform split distribution (`0`) and a logarithmic
   * one (`1`). Higher values pack more resolution into the nearer cascades
   * (crisper close-up shadows), at the cost of the far cascades; `0.8` leans
   * logarithmic, the usual recommendation. Default `0.8`.
   */
  lambda?: number;
}

/**
 * Per-light configuration for a directional light's cascaded shadow map. The
 * camera's view frustum is split into {@link numCascades} depth slices between
 * {@link minimumDistance} and {@link maximumDistance}; each slice is fit with its
 * own light-space shadow projection, so shadows stay crisp from up close out to
 * the shadow draw distance as the camera moves.
 *
 * Auto-inserted on every `DirectionalLight3d` (it is one of its required
 * components) with the defaults below; construct your own and add it to the
 * light's entity to override. A directional light without a perspective camera
 * in the scene falls back to a fixed origin-centered shadow box instead.
 */
export class CascadeShadowConfig {
  numCascades: number;
  minimumDistance: number;
  maximumDistance: number;
  firstCascadeFarBound: number | undefined;
  overlapProportion: number;
  lambda: number;

  constructor(options: CascadeShadowConfigOptions = {}) {
    this.numCascades = Math.max(1, Math.min(options.numCascades ?? 4, MAX_CASCADES));
    this.minimumDistance = options.minimumDistance ?? 0.1;
    this.maximumDistance = options.maximumDistance ?? 150;
    this.firstCascadeFarBound = options.firstCascadeFarBound;
    this.overlapProportion = options.overlapProportion ?? 0.2;
    this.lambda = options.lambda ?? 0.8;
  }
}
