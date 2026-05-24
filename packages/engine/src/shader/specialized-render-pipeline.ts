import type { RenderPipeline, RenderPipelineDescriptor } from '@retro-engine/renderer-core';

import type { PipelineCache } from './pipeline-cache';

/**
 * User-supplied builder that turns a specialization key into a
 * {@link RenderPipelineDescriptor}. Called once per distinct key — the
 * resulting descriptor goes through {@link PipelineCache}, so descriptors
 * that hash identically across different specializations still share a
 * single compiled pipeline.
 */
export type SpecializeFn<Key> = (key: Key) => RenderPipelineDescriptor;

const defaultKeyToString = <Key>(key: Key): string => JSON.stringify(key) ?? 'undefined';

/**
 * Caches render pipelines by a user-defined specialization key.
 *
 * The pattern mirrors Bevy's `SpecializedRenderPipelines<P>`: a single
 * "pipeline family" defined by a `specialize` function that maps from a
 * domain-specific `Key` (MSAA sample count, HDR enabled, target format,
 * vertex-layout enum, ...) to a fully-formed {@link RenderPipelineDescriptor}.
 * The first call with a new key builds the descriptor and routes it through
 * the shared {@link PipelineCache}; subsequent calls with an equivalent key
 * (compared via the cache's string representation) return the cached
 * pipeline directly.
 *
 * Pass a custom `keyToString` when the default `JSON.stringify` is not
 * stable for your key type — e.g. keys whose property iteration order is
 * not insertion-stable, keys with `undefined` slots, or keys that include
 * unhashable values. Plain object/number/string/boolean keys work out of
 * the box.
 *
 * Not a resource. Hold one per pipeline family in plugin closure or in a
 * user-defined resource — typical: one for sprites, one for each material
 * type, one per built-in render pass.
 */
export class SpecializedRenderPipelines<Key> {
  private readonly cached = new Map<string, RenderPipeline>();
  private readonly keyToString: (key: Key) => string;

  constructor(
    private readonly cache: PipelineCache,
    private readonly specialize: SpecializeFn<Key>,
    keyToString?: (key: Key) => string,
  ) {
    this.keyToString = keyToString ?? defaultKeyToString;
  }

  /**
   * Return the compiled pipeline for `key`, building it on first request.
   * Two calls with keys that produce the same string representation return
   * the same `RenderPipeline` instance.
   */
  get(key: Key): RenderPipeline {
    const k = this.keyToString(key);
    const cached = this.cached.get(k);
    if (cached) return cached;
    const descriptor = this.specialize(key);
    const pipeline = this.cache.getOrCreateRenderPipeline(descriptor);
    this.cached.set(k, pipeline);
    return pipeline;
  }

  /** Count of distinct specialization keys with a cached pipeline. Intended for tests / diagnostics. */
  get keyCount(): number {
    return this.cached.size;
  }
}
