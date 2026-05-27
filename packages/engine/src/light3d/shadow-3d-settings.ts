/**
 * Options accepted by the {@link Shadow3dSettings} constructor. Every field is
 * optional; omitted fields take the documented default.
 */
export interface Shadow3dSettingsOptions {
  /**
   * Half-extent (world units) of a directional light's **fallback** orthographic
   * shadow box, used only when no perspective camera drives the scene (otherwise
   * cascaded shadow maps fit the camera frustum). The box is
   * `2·directionalExtent` on a side, centered on the world origin and aimed along
   * the light's forward axis. Casters outside it receive no directional shadow.
   * Default `20`.
   */
  directionalExtent?: number;
  /** Near plane of every shadow projection (world units). Default `0.5`. */
  near?: number;
  /** Far plane of a directional light's orthographic shadow frustum (world units). Default `60`. */
  far?: number;
  /**
   * Constant depth-bias added by the shadow depth pipeline (in depth-buffer
   * units, WebGPU's `depthBias`), countering shadow acne. Default `2`.
   */
  depthBias?: number;
  /**
   * Slope-scaled depth bias for the shadow depth pipeline
   * (WebGPU's `depthBiasSlopeScale`), countering acne on grazing surfaces.
   * Default `3`.
   */
  slopeScaleBias?: number;
  /**
   * Face-culling mode of the shadow depth pass. `'front'` cuts self-shadow acne
   * but hollows thin/open geometry; `'back'` (default) matches the main pass.
   */
  cullMode?: 'back' | 'front' | 'none';
  /**
   * Extra depth (world units) each directional cascade's projection is extended
   * toward the light, so occluders just outside the cascade slice still cast into
   * it. Larger values catch more off-screen casters at the cost of depth
   * precision (and risk peter-panning). Default `30`.
   */
  cascadeBackExtension?: number;
}

/**
 * Render-world resource tuning 3D shadow-map generation. Inserted with defaults
 * by `Light3dPlugin`; insert your own before the plugin to override.
 *
 * Directional lights use cascaded shadow maps that fit the active perspective
 * camera's frustum (per-light range/quality is set on each light's
 * `CascadeShadowConfig`). When no perspective camera drives the scene, they fall
 * back to a fixed orthographic box of half-extent {@link directionalExtent}
 * around the world origin. The bias / cull settings apply to every shadow depth
 * pass (directional cascades and spot lights alike).
 */
export class Shadow3dSettings {
  directionalExtent: number;
  near: number;
  far: number;
  depthBias: number;
  slopeScaleBias: number;
  cullMode: 'back' | 'front' | 'none';
  cascadeBackExtension: number;

  constructor(options: Shadow3dSettingsOptions = {}) {
    this.directionalExtent = options.directionalExtent ?? 20;
    this.near = options.near ?? 0.5;
    this.far = options.far ?? 60;
    this.depthBias = options.depthBias ?? 2;
    this.slopeScaleBias = options.slopeScaleBias ?? 3;
    this.cullMode = options.cullMode ?? 'back';
    this.cascadeBackExtension = options.cascadeBackExtension ?? 30;
  }
}
