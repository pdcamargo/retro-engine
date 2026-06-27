import { t } from '@retro-engine/reflect';

import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { MorphWeights } from './morph-weights';

/**
 * Engine plugin for runtime morph targets (blend shapes). Registers the
 * {@link MorphWeights} component so morphing meshes round-trip through scenes and
 * code reloads, and so animation channels and the inspector can address weights
 * by target name.
 *
 * The GPU render path — the morphed pipeline variant, the per-mesh delta buffer,
 * and the per-frame weights upload — is added by this plugin only when a renderer
 * is present and reports `RendererCapabilities.storageBuffers`. On a backend
 * without it (WebGL2) morphing awaits the data-texture delivery path and a
 * morphing mesh draws from its base geometry.
 */
export class MorphPlugin implements PluginObject {
  name(): string {
    return 'MorphPlugin';
  }

  build(app: App): void {
    app.registerComponent(
      MorphWeights,
      { names: t.array(t.string), weights: t.array(t.number) },
      { name: 'MorphWeights', make: () => new MorphWeights() },
    );
  }
}
