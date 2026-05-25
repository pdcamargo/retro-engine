import type { Vec4 } from '@retro-engine/math';
import { vec4 } from '@retro-engine/math';
import type { Sampler, TextureView } from '@retro-engine/renderer-core';

import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { ShaderRegistry } from '../shader/shader-registry';

import { MaterialSchema } from './bind-group-schema';
import type { AlphaMode, Material, ShaderRef } from './material';
import { ShaderRefs } from './material';
import { UNLIT_WGSL } from './unlit.wgsl';

/**
 * Minimal Bevy parity: a material that writes `color * texture(uv)` with no
 * lighting. Pairs with `Mesh3d` to draw a flat-shaded mesh.
 *
 * Bindings (`@group(2)`):
 *
 * | Binding | Kind     | Field             |
 * |---------|----------|-------------------|
 * | 0       | uniform  | `color: vec4f`    |
 * | 1       | texture  | `colorTexture`    |
 * | 2       | sampler  | `colorSampler`    |
 *
 * The texture + sampler are required — `colorTexture` and `colorSampler` must
 * be set before adding the material to {@link Materials}. The engine ships
 * neither a default white texture nor a default sampler in Phase 7; consumers
 * create both via `renderer.createTexture` / `renderer.createSampler` and
 * pass the resulting view + sampler in.
 *
 * Register the plugin once at App build:
 *
 * ```ts
 * const unlit = new MaterialPlugin(UnlitMaterial);
 * app.addPlugin(unlit);
 * // Required-once: register the WGSL source with ShaderRegistry. The
 * // UnlitMaterialPlugin convenience class below does this for you.
 * ```
 */
export class UnlitMaterial implements Material {
  color: Vec4 = vec4.create(1, 1, 1, 1);
  colorTexture: TextureView | undefined;
  colorSampler: Sampler | undefined;
  alphaMode_: AlphaMode = 'opaque';

  constructor(init?: {
    color?: Vec4;
    colorTexture?: TextureView;
    colorSampler?: Sampler;
    alphaMode?: AlphaMode;
  }) {
    if (init?.color) this.color = init.color;
    if (init?.colorTexture) this.colorTexture = init.colorTexture;
    if (init?.colorSampler) this.colorSampler = init.colorSampler;
    if (init?.alphaMode) this.alphaMode_ = init.alphaMode;
  }

  alphaMode(): AlphaMode {
    return this.alphaMode_;
  }

  static readonly bindGroup = MaterialSchema(UnlitMaterial, [
    {
      kind: 'uniform',
      binding: 0,
      visibility: 'fragment',
      fields: [{ fieldKey: 'color', pack: 'vec4f' }],
    },
    {
      kind: 'texture',
      binding: 1,
      visibility: 'fragment',
      fieldKey: 'colorTexture',
      sampleType: 'float',
      viewDimension: '2d',
    },
    {
      kind: 'sampler',
      binding: 2,
      visibility: 'fragment',
      fieldKey: 'colorSampler',
      type: 'filtering',
    },
  ]);

  static vertexShader(): ShaderRef {
    return ShaderRefs.module('retro_engine::unlit');
  }

  static fragmentShader(): ShaderRef {
    return ShaderRefs.module('retro_engine::unlit');
  }
}

/**
 * Convenience plugin that registers `UnlitMaterial`'s WGSL with the
 * {@link ShaderRegistry} before the {@link MaterialPlugin}`<UnlitMaterial>`
 * picks it up. Add this once at App build — separate from the
 * `MaterialPlugin` so the user retains explicit control over both halves.
 *
 * ```ts
 * app.addPlugin(new UnlitMaterialPlugin());
 * app.addPlugin(new MaterialPlugin(UnlitMaterial));
 * ```
 */
export class UnlitMaterialPlugin implements PluginObject {
  name(): string {
    return 'UnlitMaterialPlugin';
  }

  isUnique(): boolean {
    // Idempotent on the registry — re-adding is a no-op rather than a throw.
    return false;
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error(
        'UnlitMaterialPlugin: ShaderRegistry resource missing; ShaderPlugin must run before this plugin.',
      );
    }
    if (!registry.has('retro_engine::unlit')) {
      registry.register('retro_engine::unlit', UNLIT_WGSL);
    }
  }
}
