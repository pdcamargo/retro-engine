import type { Vec4 } from '@retro-engine/math';
import { vec4 } from '@retro-engine/math';

import type { ImageHandle } from '../image/images';
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
 * | Binding | Kind     | Field            | Source                |
 * |---------|----------|------------------|-----------------------|
 * | 0       | uniform  | `color: vec4f`   | packed UBO            |
 * | 1       | texture  | `colorTexture`   | `Image.view`          |
 * | 2       | sampler  | `colorTexture`   | `Image.sampler`       |
 *
 * `colorTexture` is an `ImageHandle | undefined`; bindings 1 and 2 share the
 * field and bind the resolved {@link RenderImage}'s view + sampler. When
 * `colorTexture` is `undefined`, both bindings fall back to `Images.WHITE`
 * (the engine's pre-seeded 1×1 opaque-white default), so `new UnlitMaterial({
 * color })` produces a usable tint-only material with no plumbing.
 */
export class UnlitMaterial implements Material {
  color: Vec4 = vec4.create(1, 1, 1, 1);
  colorTexture: ImageHandle | undefined;
  alphaMode_: AlphaMode = 'opaque';

  constructor(init?: {
    color?: Vec4;
    colorTexture?: ImageHandle;
    alphaMode?: AlphaMode;
  }) {
    if (init?.color) this.color = init.color;
    if (init?.colorTexture !== undefined) this.colorTexture = init.colorTexture;
    if (init?.alphaMode) this.alphaMode_ = init.alphaMode;
  }

  alphaMode(): AlphaMode {
    return this.alphaMode_;
  }

  prepassWrites(): { depth: boolean; normal: boolean; motionVector: boolean } {
    // UnlitMaterial has no per-fragment surface data: no roughness, no
    // world-space normal channel beyond the geometry normal it does not
    // export. It contributes to the depth prepass only.
    return { depth: true, normal: false, motionVector: false };
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
      imageMode: 'handle',
      fieldKey: 'colorTexture',
      fallback: 'white',
      sampleType: 'float',
      viewDimension: '2d',
    },
    {
      kind: 'sampler',
      binding: 2,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'colorTexture',
      fallback: 'white',
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
