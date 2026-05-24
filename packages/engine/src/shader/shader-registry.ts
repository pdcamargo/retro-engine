/**
 * App-level registry mapping shader-module names to raw WGSL source.
 *
 * Modules are referenced from user shaders via `#import <name>` directives;
 * the WGSL preprocessor (see {@link preprocessWgsl}) inlines the registered
 * source at the import site. Names follow the Bevy convention of double-colon
 * namespacing — e.g. `retro_engine::view`, `my_game::shared_uniforms` — but
 * the registry treats the name as an opaque string. Filesystem-rooted paths
 * (and asset handles) land with the asset system; this registry is the
 * raw-source path that ships ahead of it.
 *
 * The engine pre-registers `retro_engine::view` with the view uniform struct
 * + bind group declaration so user shaders can read camera data without
 * copy-pasting the snippet.
 *
 * Inserted by `shaderPlugin`; accessed in main-world systems via
 * `Res(ShaderRegistry)` / `ResMut(ShaderRegistry)`. The render-world
 * `PipelineCache` holds its own reference so render-stage compiles do not
 * need a system param.
 */
export class ShaderRegistry {
  private readonly sources = new Map<string, string>();

  /**
   * Register a module under `name`. Re-registering the same name replaces
   * the prior source — callers may rely on this for dynamic-shader scenarios
   * once hot reload lands (see ADR-0022 "not yet done").
   */
  register(name: string, source: string): void {
    this.sources.set(name, source);
  }

  /** True if a module is registered under `name`. */
  has(name: string): boolean {
    return this.sources.has(name);
  }

  /** Raw registered source, or `undefined` when no module matches. */
  get(name: string): string | undefined {
    return this.sources.get(name);
  }

  /** Enumerate every registered module name. Stable insertion order. */
  names(): IterableIterator<string> {
    return this.sources.keys();
  }
}
