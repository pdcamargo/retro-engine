import type { Vec4 } from '@retro-engine/math';
import { vec4 } from '@retro-engine/math';
import type { Sampler, TextureView } from '@retro-engine/renderer-core';

import type { App } from '../index';
import type { PluginObject } from '../plugin';
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
 * | Binding | Kind     | Field                       |
 * |---------|----------|-----------------------------|
 * | 0       | uniform  | packed material struct      |
 * | 1       | texture  | `baseColorTexture`          |
 * | 2       | sampler  | `materialSampler`           |
 * | 3       | texture  | `metallicRoughnessTexture`  |
 * | 4       | texture  | `normalMapTexture`          |
 * | 5       | texture  | `emissiveTexture`           |
 * | 6       | texture  | `occlusionTexture`          |
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
 * All five texture slots are required in Phase 7 — the schema walker throws
 * when a referenced field is `undefined`. Consumers spawning a PBR material
 * without (say) a normal map create a 1×1 default texture and pass its view
 * for the missing slots. A default-texture convenience helper is on the
 * Phase 7.x slate.
 *
 * **Lighting placeholder.** Phase 7's `pbr.wgsl` evaluates Cook-Torrance
 * against a single hardcoded directional light and a constant ambient term.
 * Phase 10's `Lights` uniform replaces both. The math (Lambert + GGX + Schlick
 * with energy conservation) is real PBR; only the light source is
 * placeholder.
 *
 * **IBL is Phase 10.7.** When environment-map sampling lands, this material
 * gains an optional environment handle and the shader's ambient term lights
 * up from the precomputed irradiance + prefiltered env map.
 */
export class StandardMaterial implements Material {
  baseColor: Vec4 = vec4.create(1, 1, 1, 1);
  emissive: Vec4 = vec4.create(0, 0, 0, 0);
  metallic = 0;
  roughness = 0.5;
  occlusionStrength = 1;
  alphaCutoff = 0.5;

  baseColorTexture: TextureView | undefined;
  materialSampler: Sampler | undefined;
  metallicRoughnessTexture: TextureView | undefined;
  normalMapTexture: TextureView | undefined;
  emissiveTexture: TextureView | undefined;
  occlusionTexture: TextureView | undefined;

  alphaMode_: AlphaMode = 'opaque';
  depthBias_ = 0;

  constructor(init?: {
    baseColor?: Vec4;
    emissive?: Vec4;
    metallic?: number;
    roughness?: number;
    occlusionStrength?: number;
    alphaCutoff?: number;
    baseColorTexture?: TextureView;
    materialSampler?: Sampler;
    metallicRoughnessTexture?: TextureView;
    normalMapTexture?: TextureView;
    emissiveTexture?: TextureView;
    occlusionTexture?: TextureView;
    alphaMode?: AlphaMode;
    depthBias?: number;
  }) {
    if (init?.baseColor) this.baseColor = init.baseColor;
    if (init?.emissive) this.emissive = init.emissive;
    if (init?.metallic !== undefined) this.metallic = init.metallic;
    if (init?.roughness !== undefined) this.roughness = init.roughness;
    if (init?.occlusionStrength !== undefined) this.occlusionStrength = init.occlusionStrength;
    if (init?.alphaCutoff !== undefined) this.alphaCutoff = init.alphaCutoff;
    if (init?.baseColorTexture) this.baseColorTexture = init.baseColorTexture;
    if (init?.materialSampler) this.materialSampler = init.materialSampler;
    if (init?.metallicRoughnessTexture)
      this.metallicRoughnessTexture = init.metallicRoughnessTexture;
    if (init?.normalMapTexture) this.normalMapTexture = init.normalMapTexture;
    if (init?.emissiveTexture) this.emissiveTexture = init.emissiveTexture;
    if (init?.occlusionTexture) this.occlusionTexture = init.occlusionTexture;
    if (init?.alphaMode) this.alphaMode_ = init.alphaMode;
    if (init?.depthBias !== undefined) this.depthBias_ = init.depthBias;
  }

  alphaMode(): AlphaMode {
    return this.alphaMode_;
  }

  depthBias(): number {
    return this.depthBias_;
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
      fieldKey: 'baseColorTexture',
      sampleType: 'float',
      viewDimension: '2d',
    },
    {
      kind: 'sampler',
      binding: 2,
      visibility: 'fragment',
      fieldKey: 'materialSampler',
      type: 'filtering',
    },
    {
      kind: 'texture',
      binding: 3,
      visibility: 'fragment',
      fieldKey: 'metallicRoughnessTexture',
      sampleType: 'float',
      viewDimension: '2d',
    },
    {
      kind: 'texture',
      binding: 4,
      visibility: 'fragment',
      fieldKey: 'normalMapTexture',
      sampleType: 'float',
      viewDimension: '2d',
    },
    {
      kind: 'texture',
      binding: 5,
      visibility: 'fragment',
      fieldKey: 'emissiveTexture',
      sampleType: 'float',
      viewDimension: '2d',
    },
    {
      kind: 'texture',
      binding: 6,
      visibility: 'fragment',
      fieldKey: 'occlusionTexture',
      sampleType: 'float',
      viewDimension: '2d',
    },
  ]);

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
    if (!registry.has('retro_engine::pbr')) {
      registry.register('retro_engine::pbr', PBR_WGSL);
    }
  }
}
