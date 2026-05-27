/**
 * Options accepted by the {@link Shadow3dSettings} constructor. Every field is
 * optional; omitted fields take the documented default.
 */
export interface Shadow3dSettingsOptions {
  /**
   * Half-extent (world units) of a directional light's orthographic shadow
   * frustum. The shadow box is `2·directionalExtent` on a side, centered on the
   * world origin and aimed along the light's forward axis. Casters outside this
   * box receive no directional shadow. Default `20`.
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
}

/**
 * Render-world resource tuning 3D shadow-map generation. Inserted with defaults
 * by `Light3dPlugin`; insert your own before the plugin to override.
 *
 * The directional shadow frustum is a fixed orthographic box around the world
 * origin (it does not follow the camera or fit the scene). Casters far from the
 * origin fall outside it and go unshadowed; raise {@link directionalExtent} to
 * cover a larger scene. Camera-following cascaded shadow maps remove this
 * limitation in a later stage.
 */
export class Shadow3dSettings {
  directionalExtent: number;
  near: number;
  far: number;
  depthBias: number;
  slopeScaleBias: number;
  cullMode: 'back' | 'front' | 'none';

  constructor(options: Shadow3dSettingsOptions = {}) {
    this.directionalExtent = options.directionalExtent ?? 20;
    this.near = options.near ?? 0.5;
    this.far = options.far ?? 60;
    this.depthBias = options.depthBias ?? 2;
    this.slopeScaleBias = options.slopeScaleBias ?? 3;
    this.cullMode = options.cullMode ?? 'back';
  }
}
