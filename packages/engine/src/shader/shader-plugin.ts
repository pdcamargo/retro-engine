import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { PipelineCache } from './pipeline-cache';
import { ShaderRegistry } from './shader-registry';

/**
 * Engine-internal plugin wiring the App-wide shader infrastructure: the
 * {@link ShaderRegistry} that holds named WGSL modules for `#import`
 * resolution, and the {@link PipelineCache} that dedupes compiled
 * `ShaderModule`s and `RenderPipeline`s across every render-stage system.
 *
 * Installed by `CorePlugin` immediately before `CameraPlugin`, so the
 * camera plugin's `build` step can register the canonical
 * `retro_engine::view` module onto the freshly-created registry. User
 * plugins that need to pre-register their own modules add a `build`
 * step that pulls the registry via `app.getResource(ShaderRegistry)`
 * and calls `register('my_crate::my_module', wgslSource)`.
 *
 * Unique — re-adding manually throws.
 */
export class ShaderPlugin implements PluginObject {
  name(): string {
    return 'ShaderPlugin';
  }

  build(app: App): void {
    const registry = new ShaderRegistry();
    app.insertResource(registry);
    app.insertResource(new PipelineCache(app.renderer, registry));
  }
}
