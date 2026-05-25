import type { Vec4 } from '@retro-engine/math';
import { vec4 } from '@retro-engine/math';

import type { App } from '../index';
import { MaterialSchema } from '../material/bind-group-schema';
import type { AlphaMode, ShaderRef } from '../material/material';
import { ShaderRefs } from '../material/material';
import type { PluginObject } from '../plugin';
import { ShaderRegistry } from '../shader/shader-registry';

import { COLOR_MATERIAL_2D_WGSL } from './color-material-2d.wgsl';
import type { Material2d } from './material-2d';

/**
 * Default alpha-cutoff for `alphaMode: { kind: 'mask' }` when the consumer
 * omits an explicit `cutoff` field. Discards every fragment whose alpha is
 * strictly below this value. The threshold is hardcoded for the initial
 * Phase 8.7 ship; per-material tunable thresholds land alongside a measured-
 * performance consumer ask.
 */
export const COLOR_MATERIAL_2D_DEFAULT_MASK_CUTOFF = 0.5;

/**
 * Minimal Bevy parity: a 2D Material2d that writes a single uniform color.
 * Pairs with `Mesh2d` to draw a flat-shaded 2D mesh in Core2d.
 *
 * Bindings (`@group(2)`):
 *
 * | Binding | Kind     | Field           | Layout                       |
 * |---------|----------|-----------------|------------------------------|
 * | 0       | uniform  | `color`         | `vec4f` at offset 0          |
 * | 0       | uniform  | `alphaCutoff`   | `f32` at offset 16           |
 *
 * Both fields share one packed UBO slot (binding 0). `alphaCutoff` is derived
 * from `alphaMode` at construction (and on every `setAlphaMode`): `'opaque'`
 * and `'blend'` set it to `0` (fragment skip the discard branch); `{ kind:
 * 'mask', cutoff }` sets it to `cutoff` so the fragment shader discards every
 * pixel with `color.a < cutoff`.
 *
 * The alpha bucket the queue routes to (Opaque2d / AlphaMask2d / Transparent2d)
 * is derived from `alphaMode()` directly — the color's alpha channel does not
 * route. A `ColorMaterial2d({ color: vec4(1,1,1,0.5) })` with the default
 * `alphaMode: 'opaque'` renders into Opaque2d and the GPU ignores the alpha
 * channel; consumers who want alpha blending must pass `alphaMode: 'blend'`
 * explicitly.
 */
export class ColorMaterial2d implements Material2d {
  color: Vec4 = vec4.create(1, 1, 1, 1);
  alphaCutoff = 0;
  alphaMode_: AlphaMode = 'opaque';

  constructor(init?: { color?: Vec4; alphaMode?: AlphaMode }) {
    if (init?.color) this.color = init.color;
    if (init?.alphaMode) this.setAlphaMode(init.alphaMode);
  }

  alphaMode(): AlphaMode {
    return this.alphaMode_;
  }

  /**
   * Update the material's alpha mode and re-derive `alphaCutoff` for the
   * shader. Call this when changing modes at runtime; mutating
   * `alphaMode_` directly will leave `alphaCutoff` stale and the fragment
   * shader will continue applying the previous discard threshold.
   */
  setAlphaMode(mode: AlphaMode): void {
    this.alphaMode_ = mode;
    if (typeof mode === 'object' && mode.kind === 'mask') {
      this.alphaCutoff = mode.cutoff;
    } else {
      this.alphaCutoff = 0;
    }
  }

  static readonly bindGroup = MaterialSchema(ColorMaterial2d, [
    {
      kind: 'uniform',
      binding: 0,
      visibility: 'fragment',
      fields: [
        { fieldKey: 'color', pack: 'vec4f' },
        { fieldKey: 'alphaCutoff', pack: 'f32' },
      ],
    },
  ]);

  static vertexShader(): ShaderRef {
    return ShaderRefs.module('retro_engine::color_material_2d');
  }

  static fragmentShader(): ShaderRef {
    return ShaderRefs.module('retro_engine::color_material_2d');
  }
}

/**
 * Convenience plugin that registers `ColorMaterial2d`'s WGSL with the
 * {@link ShaderRegistry} before a `Material2dPlugin<ColorMaterial2d>` picks
 * it up. Add this once at App build — separate from the `Material2dPlugin`
 * so the user retains explicit control over both halves.
 *
 * ```ts
 * app.addPlugin(new ColorMaterial2dPlugin());
 * app.addPlugin(new Material2dPlugin(ColorMaterial2d));
 * ```
 */
export class ColorMaterial2dPlugin implements PluginObject {
  name(): string {
    return 'ColorMaterial2dPlugin';
  }

  isUnique(): boolean {
    return false;
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error(
        'ColorMaterial2dPlugin: ShaderRegistry resource missing; ShaderPlugin must run before this plugin.',
      );
    }
    if (!registry.has('retro_engine::color_material_2d')) {
      registry.register('retro_engine::color_material_2d', COLOR_MATERIAL_2D_WGSL);
    }
  }
}
