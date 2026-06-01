import type { Handle } from '@retro-engine/assets';
import type { Vec4 } from '@retro-engine/math';
import { vec4 } from '@retro-engine/math';

import type { Image } from '../image/image';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { PREPASS_WGSL } from '../prepass/prepass.wgsl';
import { ShaderRegistry } from '../shader/shader-registry';

import { MaterialSchema } from './bind-group-schema';
import type { AlphaMode, Material, ShaderRef } from './material';
import { ShaderRefs } from './material';
import { PBR_WGSL } from './pbr.wgsl';

/**
 * Metallic-roughness PBR material — Bevy's `StandardMaterial` minus IBL.
 *
 * Bindings (`@group(2)`):
 *
 * | Binding | Kind     | Field                       | Source                         |
 * |---------|----------|-----------------------------|--------------------------------|
 * | 0       | uniform  | packed material struct      | `baseColor`, `emissive`, `metallic`, `roughness`, `occlusionStrength`, `alphaCutoff` |
 * | 1       | texture  | `baseColorTexture`          | `Image.view`                   |
 * | 2       | sampler  | `baseColorTexture` (shared) | `Image.sampler` (primary)      |
 * | 3       | texture  | `metallicRoughnessTexture`  | `Image.view`                   |
 * | 4       | texture  | `normalMapTexture`          | `Image.view`                   |
 * | 5       | texture  | `emissiveTexture`           | `Image.view`                   |
 * | 6       | texture  | `occlusionTexture`          | `Image.view`                   |
 *
 * All five texture slots are `Handle<Image> | undefined` fields. When a field
 * is `undefined`, the bind-group schema falls back to a well-known default on
 * the {@link Images} registry: `baseColorTexture` / `metallicRoughnessTexture`
 * / `emissiveTexture` / `occlusionTexture` fall back to `Images.WHITE`,
 * `normalMapTexture` falls back to `Images.NORMAL_FLAT` (the flat
 * `(0.5, 0.5, 1, 1)` tangent-space identity normal). `new StandardMaterial({
 * baseColor })` therefore produces a usable PBR material with no manual
 * texture authoring.
 *
 * **Sampler model.** The PBR shader (`pbr.wgsl`) uses a single sampler
 * declared at `@group(2) @binding(2)` for all five texture taps. The schema's
 * sampler entry shares its `fieldKey` with the binding-1 `baseColorTexture`
 * entry — i.e. the sampler resolves through whichever Image is bound at
 * binding 1 (or `Images.WHITE` when undefined). All five PBR textures sample
 * through that one sampler. Per-channel sampling control (one sampler per
 * texture) is a future expansion and would require new bindings + a WGSL
 * rewrite.
 *
 * The packed uniform struct (48 bytes, std140-laid-out by the schema walker):
 *
 * ```wgsl
 * struct StandardMaterialUniform {
 *   base_color: vec4<f32>,      // offset 0
 *   emissive: vec4<f32>,        // offset 16 (alpha unused)
 *   metallic: f32,              // offset 32
 *   roughness: f32,             // offset 36
 *   occlusion_strength: f32,    // offset 40
 *   alpha_cutoff: f32,          // offset 44
 * };
 * ```
 *
 * **Lighting requires `Light3dPlugin`.** `pbr.wgsl` evaluates Cook-Torrance
 * against the analytic lights packed into the `retro_engine::light3d`
 * `GpuLights` uniform (`@group(2)`). `StandardMaterial` therefore needs a
 * `Light3dPlugin` registered on the App (alongside `StandardMaterialPlugin` +
 * `MaterialPlugin(StandardMaterial)`) — without it the lights bind group and
 * shader module are absent and pipeline creation fails. The math (Lambert +
 * GGX + Schlick with energy conservation) is real PBR.
 *
 * **IBL is Phase 10.7.** When environment-map sampling lands, this material
 * gains an optional environment handle and the shader's flat ambient term is
 * replaced by precomputed irradiance + a prefiltered env map.
 */
export class StandardMaterial implements Material {
  baseColor: Vec4 = vec4.create(1, 1, 1, 1);
  emissive: Vec4 = vec4.create(0, 0, 0, 0);
  metallic = 0;
  roughness = 0.5;
  occlusionStrength = 1;
  alphaCutoff = 0.5;

  baseColorTexture: Handle<Image> | undefined;
  metallicRoughnessTexture: Handle<Image> | undefined;
  normalMapTexture: Handle<Image> | undefined;
  emissiveTexture: Handle<Image> | undefined;
  occlusionTexture: Handle<Image> | undefined;

  alphaMode_: AlphaMode = 'opaque';
  depthBias_ = 0;

  constructor(init?: {
    baseColor?: Vec4;
    emissive?: Vec4;
    metallic?: number;
    roughness?: number;
    occlusionStrength?: number;
    alphaCutoff?: number;
    baseColorTexture?: Handle<Image>;
    metallicRoughnessTexture?: Handle<Image>;
    normalMapTexture?: Handle<Image>;
    emissiveTexture?: Handle<Image>;
    occlusionTexture?: Handle<Image>;
    alphaMode?: AlphaMode;
    depthBias?: number;
  }) {
    if (init?.baseColor) this.baseColor = init.baseColor;
    if (init?.emissive) this.emissive = init.emissive;
    if (init?.metallic !== undefined) this.metallic = init.metallic;
    if (init?.roughness !== undefined) this.roughness = init.roughness;
    if (init?.occlusionStrength !== undefined) this.occlusionStrength = init.occlusionStrength;
    if (init?.alphaCutoff !== undefined) this.alphaCutoff = init.alphaCutoff;
    if (init?.baseColorTexture !== undefined) this.baseColorTexture = init.baseColorTexture;
    if (init?.metallicRoughnessTexture !== undefined)
      this.metallicRoughnessTexture = init.metallicRoughnessTexture;
    if (init?.normalMapTexture !== undefined) this.normalMapTexture = init.normalMapTexture;
    if (init?.emissiveTexture !== undefined) this.emissiveTexture = init.emissiveTexture;
    if (init?.occlusionTexture !== undefined) this.occlusionTexture = init.occlusionTexture;
    if (init?.alphaMode) this.alphaMode_ = init.alphaMode;
    if (init?.depthBias !== undefined) this.depthBias_ = init.depthBias;
  }

  alphaMode(): AlphaMode {
    return this.alphaMode_;
  }

  depthBias(): number {
    return this.depthBias_;
  }

  prepassWrites(): { depth: boolean; normal: boolean; motionVector: boolean } {
    // StandardMaterial writes depth, world-space normal (with roughness),
    // and a screen-space motion vector. The pbr.wgsl module exposes
    // `fs_prepass_normal`, `fs_prepass_motion`, and the combined
    // `fs_prepass_normal_motion` fragment entries; the previous-instance
    // vertex buffer feeds the motion branch.
    return { depth: true, normal: true, motionVector: true };
  }

  static readonly bindGroup = MaterialSchema(StandardMaterial, [
    {
      kind: 'uniform',
      binding: 0,
      visibility: 'fragment',
      fields: [
        { fieldKey: 'baseColor', pack: 'vec4f' },
        { fieldKey: 'emissive', pack: 'vec4f' },
        { fieldKey: 'metallic', pack: 'f32' },
        { fieldKey: 'roughness', pack: 'f32' },
        { fieldKey: 'occlusionStrength', pack: 'f32' },
        { fieldKey: 'alphaCutoff', pack: 'f32' },
      ],
    },
    {
      kind: 'texture',
      binding: 1,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'baseColorTexture',
      fallback: 'white',
      sampleType: 'float',
      viewDimension: '2d',
    },
    {
      kind: 'sampler',
      binding: 2,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'baseColorTexture',
      fallback: 'white',
      type: 'filtering',
    },
    {
      kind: 'texture',
      binding: 3,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'metallicRoughnessTexture',
      fallback: 'white',
      sampleType: 'float',
      viewDimension: '2d',
    },
    {
      kind: 'texture',
      binding: 4,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'normalMapTexture',
      fallback: 'normalFlat',
      sampleType: 'float',
      viewDimension: '2d',
    },
    {
      kind: 'texture',
      binding: 5,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'emissiveTexture',
      fallback: 'white',
      sampleType: 'float',
      viewDimension: '2d',
    },
    {
      kind: 'texture',
      binding: 6,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'occlusionTexture',
      fallback: 'white',
      sampleType: 'float',
      viewDimension: '2d',
    },
  ]);

  /**
   * Marks this material as lit: {@link MaterialPlugin} appends the
   * `retro_engine::light3d` `GpuLights` bind group to the pipeline layout at
   * `@group(2)`, and the Core3d phase nodes bind it. Requires `Light3dPlugin`.
   */
  static readonly usesLights = true;

  /**
   * Opts this material's lit opaque variant into screen-space ambient
   * occlusion: when a camera has an active {@link ScreenSpaceAo} target,
   * {@link MaterialPlugin} appends the AO read binding at `@group(3)` and
   * `pbr.wgsl`'s `fs_main` folds the sampled occlusion into the ambient term.
   */
  static readonly usesAo = true;

  static vertexShader(): ShaderRef {
    return ShaderRefs.module('retro_engine::pbr');
  }

  static fragmentShader(): ShaderRef {
    return ShaderRefs.module('retro_engine::pbr');
  }
}

/**
 * Convenience plugin that registers `StandardMaterial`'s WGSL with the
 * {@link ShaderRegistry} before {@link MaterialPlugin}`<StandardMaterial>`
 * picks it up. Add once at App build; pair with the material plugin:
 *
 * ```ts
 * app.addPlugin(new StandardMaterialPlugin());
 * app.addPlugin(new MaterialPlugin(StandardMaterial));
 * ```
 *
 * Idempotent — re-adding is a no-op.
 */
export class StandardMaterialPlugin implements PluginObject {
  name(): string {
    return 'StandardMaterialPlugin';
  }

  isUnique(): boolean {
    return false;
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error(
        'StandardMaterialPlugin: ShaderRegistry resource missing; ShaderPlugin must run before this plugin.',
      );
    }
    if (!registry.has('retro_engine::prepass')) {
      // pbr.wgsl imports the prepass helpers (encode_normal_roughness,
      // compute_motion_vector). Register the dependency module first so
      // the import resolves even when the consumer hasn't added
      // `PrepassPlugin`.
      registry.register('retro_engine::prepass', PREPASS_WGSL);
    }
    if (!registry.has('retro_engine::pbr')) {
      registry.register('retro_engine::pbr', PBR_WGSL);
    }
  }
}
