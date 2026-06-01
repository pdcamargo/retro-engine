/**
 * Material — the consumer-facing trait for a class that contributes a draw to
 * a `Mesh3d` entity. Implement by any user class that wants to ship a shader +
 * a bind-group schema.
 *
 * Instance methods are all optional with documented defaults; classes that
 * just want plain opaque rendering with no depth bias can skip the bodies.
 *
 * The static surface — `static bindGroup`, `static vertexShader?()`,
 * `static fragmentShader?()`, `static specialize?(...)` — is contracted by
 * convention (TypeScript does not yet model static-method polymorphism). The
 * `MaterialPlugin<M>.build()` validates the statics at registration time.
 *
 * The engine sets `@group(0)` to the view bind group on every camera pass
 * (ADR-0028) — user material pipelines that need `@group(0)` for their own
 * data are unsupported. Material bind groups live at `@group(2)`; per-entity
 * transform data at `@group(1)`.
 */
export interface Material {
  /**
   * The alpha-blending mode for this material. Defaults to `'opaque'` (no
   * blend, depth-write enabled). `'blend'` enables the `Transparent3d` phase
   * (back-to-front sort, no depth write). The mask form enables the
   * `AlphaMask3d` phase (depth-write enabled, fragment shader discards below
   * `cutoff`).
   */
  alphaMode?(): AlphaMode;
  /**
   * Constant depth-bias applied to this material's pipeline. Defaults to 0.
   * Used by shadow-map polygon-offset techniques and by decals that want to
   * draw on top of a coplanar opaque surface without z-fighting.
   *
   * Pairs with ADR-0029's `depthBias` / `depthBiasSlopeScale` /
   * `depthBiasClamp` triple on `DepthStencilState` — the integer returned here
   * becomes `depthBias`; the slope-scale and clamp default to 0 unless the
   * material's `specialize()` overrides them.
   */
  depthBias?(): number;
  /**
   * Whether both faces of the geometry are rendered. Defaults to `false` —
   * back faces are culled (the usual choice for solid, consistently-wound
   * meshes). When `true`, the material's pipeline disables face culling and
   * the shader flips the shading normal on back faces, so single-sided
   * surfaces (foliage, cards, glass) shade correctly from both sides.
   */
  doubleSided?(): boolean;
  /**
   * Which screen-space prepass outputs this material can correctly write.
   * Defaults to all-`false` (the material does not participate in the
   * prepass). Materials opt in per-channel; the engine intersects the
   * returned flags with the camera's enabled prepass markers and queues a
   * prepass draw only when at least one channel is shared.
   *
   * `StandardMaterial` returns all three; `UnlitMaterial` returns
   * `{ depth: true, normal: false, motionVector: false }` (it has no normal
   * data and no current-frame-only motion to express). Materials that
   * cannot or should not pre-write any channel — particles, decals,
   * arbitrary post-effect surfaces — should leave this method unset.
   */
  prepassWrites?(): import('../prepass/components').PrepassFlags;
}

/**
 * How a material's alpha channel participates in the draw.
 *
 * - `'opaque'` — depth-write enabled, no blend. The fragment's alpha is
 *   written to the color target but ignored for visibility.
 * - `{ kind: 'mask', cutoff }` — depth-write enabled, no blend. The fragment
 *   shader discards (`discard`) when `alpha < cutoff`; passing fragments
 *   write color and depth normally. Use for foliage, chain-link fences,
 *   anything where binary visibility is correct.
 * - `'blend'` — depth-write disabled, premultiplied-alpha blend. Drawn in the
 *   `Transparent3d` phase after the opaque pass, sorted back-to-front for
 *   correct compositing.
 */
export type AlphaMode =
  | 'opaque'
  | { readonly kind: 'mask'; readonly cutoff: number }
  | 'blend';

/**
 * Reference to a shader module the renderer should use for a stage. Either a
 * registered module name (resolved through `ShaderRegistry`) or the engine
 * default for the stage.
 *
 * Materials declare `static vertexShader()` / `static fragmentShader()`
 * returning a `ShaderRef`. The default form falls back to the engine's
 * built-in vertex / fragment shaders (`retro_engine::pbr_vertex` etc. for
 * `StandardMaterial`; resolved by `MaterialPlugin<M>` from the material
 * class's identity).
 */
export type ShaderRef =
  | { readonly kind: 'default' }
  | { readonly kind: 'module'; readonly name: string };

/**
 * Helpers to build a {@link ShaderRef} in idiomatic call sites.
 *
 * ```ts
 * static vertexShader() { return ShaderRefs.default(); }
 * static fragmentShader() { return ShaderRefs.module('my_game::cel_shade'); }
 * ```
 */
export const ShaderRefs = {
  default: (): ShaderRef => ({ kind: 'default' }),
  module: (name: string): ShaderRef => ({ kind: 'module', name }),
} as const;

/**
 * Specialization key consumed by `MaterialPlugin<M>` to vary the
 * `RenderPipelineDescriptor` per (camera, mesh, material variant). Keyed
 * through `SpecializedRenderPipelines<MaterialPipelineKey>` (ADR-0022).
 *
 * The key composes four orthogonal dimensions:
 *
 * - `msaaSamples`: from `Camera.msaaSamples` (planned). 1 today; 4 lights up
 *   when `Camera.msaaSamples: 1 | 4` lands.
 * - `hdr`: from `Camera.hdr`. Picks the color-target format and the
 *   fragment-shader output mode.
 * - `vertexLayoutDigest`: FNV-1a hash of the mesh's `MeshVertexBufferLayoutRef`
 *   shape. Two meshes that produce the same layout share a pipeline; two
 *   meshes that differ in attribute set produce two pipelines.
 * - `alphaMode`: from `Material.alphaMode()`. Drives the
 *   `Opaque3d` / `AlphaMask3d` / `Transparent3d` phase split.
 *
 * Material-specific variants (e.g., a shader feature flag) are not part of
 * this struct — they're handled by `M.specialize?.()`, which mutates the
 * pipeline descriptor before it reaches the cache. The cache's structural
 * digest (ADR-0028, `pipeline-cache.descriptorKey`) catches the resulting
 * variation.
 */
export interface MaterialPipelineKey {
  readonly msaaSamples: 1 | 4;
  readonly hdr: boolean;
  readonly vertexLayoutDigest: string;
  readonly alphaMode: AlphaMode;
  /**
   * When present, marks this as a **prepass** pipeline variant. The
   * pipeline cache builds one pipeline per unique flag combination:
   * depth-only (`fragment: undefined`), depth + normal, depth + motion
   * vector, or all three. Absence means the pipeline targets the opaque
   * (or transparent) shading pass.
   */
  readonly prepass?: import('../prepass/components').PrepassFlags;
  /**
   * When present, the opaque pipeline includes a `@group(3)` bind group
   * with the camera's prepass textures so the fragment shader can sample
   * them. Flags select which textures are bound (and therefore which
   * pipeline variant is generated).
   *
   * Wired in this slice for forward-compatibility with downstream temporal
   * effects (TAA, motion blur, SSAO); `pbr.wgsl`'s `fs_main` does not yet
   * sample these. Expect a follow-up ADR to introduce the shader reads.
   */
  readonly prepassReadable?: {
    readonly normal: boolean;
    readonly motionVector: boolean;
  };
  /**
   * When `true`, this lit-material variant samples a screen-space
   * ambient-occlusion factor from a `@group(3)` binding and folds it into its
   * ambient term. Selected per camera by `MaterialPlugin` when the camera has an
   * active AO target and the material declares `static usesAo` — it keys a
   * distinct pipeline (extra bind group + the `ENABLE_SSAO` shader define), so
   * the AO and non-AO variants never share a pipeline.
   */
  readonly aoEnabled?: boolean;
  /**
   * When `true`, the pipeline renders both faces (cull mode `none`) instead of
   * culling back faces. Sourced from `Material.doubleSided()`; absent means
   * single-sided (back-face culling). Keys a distinct pipeline so single- and
   * double-sided variants of the same material never share one.
   */
  readonly doubleSided?: boolean;
}

/**
 * Convenience: stable string form of an {@link AlphaMode} for use in cache
 * keys, log messages, and tests.
 */
export const alphaModeKey = (mode: AlphaMode): string => {
  if (mode === 'opaque' || mode === 'blend') return mode;
  return `mask@${mode.cutoff}`;
};
