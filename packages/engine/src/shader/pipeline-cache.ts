import type {
  PipelineLayout,
  Renderer,
  RenderPipeline,
  RenderPipelineDescriptor,
  ShaderModule,
} from '@retro-engine/renderer-core';

import { preprocessWgsl, type PreprocessOptions } from './preprocessor';
import type { Shader } from './shader';
import type { ShaderRegistry } from './shader-registry';

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * 32-bit FNV-1a hash of a string, rendered as an unsigned hex string. Stable
 * across machines; not cryptographic. Identical inputs hash identically, so
 * the {@link PipelineCache} can use the result as a structural key.
 *
 * @internal
 */
const fnv1a = (s: string): string => {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return (h >>> 0).toString(16);
};

/**
 * Deduplicating registry for compiled shader modules and render pipelines,
 * shared across every render-stage system in the App.
 *
 * Two dedupe responsibilities:
 *
 * 1. **Shader modules** are keyed by the hash of their *preprocessed* WGSL
 *    source. {@link compileShader} runs the source through
 *    {@link preprocessWgsl} against the registered {@link ShaderRegistry}
 *    before hashing, so two `Shader`s that import the same module and
 *    resolve to the same final text share one `ShaderModule`.
 * 2. **Render pipelines** are keyed by a descriptor digest: the hash of
 *    each `ShaderModule`'s source, the entry-point names, color-target
 *    formats, primitive topology, and the identity of the
 *    `PipelineLayout` (or `'auto'`). Two descriptors that produce the
 *    same digest reuse a single compiled `RenderPipeline`.
 *
 * Both caches grow without pruning today — render-world resources persist
 * across frames per ADR-0019, and Phase 4 has no concept of asset
 * lifetimes (those land alongside the asset system). Hot-reload-driven
 * invalidation is on the same Phase 4 deferral list.
 *
 * Inserted as an App resource by {@link shaderPlugin}; render-stage
 * systems pull it through `ResMut(PipelineCache)`. Holding a private
 * reference for setup-time use (e.g. inside a plugin's startup system) is
 * also fine — the cache outlives every frame.
 */
export class PipelineCache {
  private readonly moduleCache = new Map<string, ShaderModule>();
  private readonly pipelineCache = new Map<string, RenderPipeline>();
  private readonly moduleHashes = new WeakMap<ShaderModule, string>();
  private readonly layoutIds = new WeakMap<PipelineLayout, string>();
  private readonly fallbackIds = new WeakMap<object, string>();
  private nextLayoutId = 0;
  private nextFallbackId = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly registry: ShaderRegistry,
  ) {}

  /**
   * Preprocess a {@link Shader} (resolving `#import` / `#define` / `#ifdef`
   * against the cache's registry) and return the compiled `ShaderModule`.
   * Identical preprocessed sources hit the cache and return the same handle.
   *
   * `defines` are passed through to {@link preprocessWgsl}; identical
   * `Shader` + `defines` combinations are guaranteed to produce the same
   * preprocessed source and therefore share one module.
   */
  compileShader(shader: Shader, defines?: PreprocessOptions['defines']): ShaderModule {
    const options: PreprocessOptions = {};
    if (defines !== undefined) options.defines = defines;
    if (shader.label !== undefined) options.shaderLabel = shader.label;
    const code = preprocessWgsl(shader.source, this.registry, options);
    return this.getOrCreateShaderModule(code, shader.label);
  }

  /**
   * Cache-lookup form for callers that already have fully-substituted WGSL
   * source — e.g. tests, tooling, or shaders that bypass the preprocessor
   * entirely. Identical sources hit the cache. `compileShader` is the usual
   * entry point.
   */
  getOrCreateShaderModule(code: string, label?: string): ShaderModule {
    const hash = fnv1a(code);
    const cached = this.moduleCache.get(hash);
    if (cached) return cached;
    const moduleDescriptor: { code: string; label?: string } = { code };
    if (label !== undefined) moduleDescriptor.label = label;
    const module = this.renderer.createShaderModule(moduleDescriptor);
    this.moduleCache.set(hash, module);
    this.moduleHashes.set(module, hash);
    return module;
  }

  /**
   * Return a compiled pipeline matching `descriptor`. Two descriptors that
   * differ only in label still share a pipeline — labels are advisory.
   * `ShaderModule`s contribute their preprocessed-source hash; user
   * `PipelineLayout`s contribute object identity.
   */
  getOrCreateRenderPipeline(descriptor: RenderPipelineDescriptor): RenderPipeline {
    const key = this.descriptorKey(descriptor);
    const cached = this.pipelineCache.get(key);
    if (cached) return cached;
    const pipeline = this.renderer.createRenderPipeline(descriptor);
    this.pipelineCache.set(key, pipeline);
    return pipeline;
  }

  /** Count of distinct shader modules currently cached. Intended for tests / diagnostics. */
  get shaderModuleCount(): number {
    return this.moduleCache.size;
  }

  /** Count of distinct render pipelines currently cached. Intended for tests / diagnostics. */
  get renderPipelineCount(): number {
    return this.pipelineCache.size;
  }

  private descriptorKey(d: RenderPipelineDescriptor): string {
    const layoutPart =
      d.layout === undefined || d.layout === 'auto' ? 'auto' : this.layoutKey(d.layout);
    const vertexPart = `${this.moduleKey(d.vertex.module)}@${d.vertex.entryPoint}#${this.vertexBuffersKey(d.vertex.buffers)}`;
    const fragmentPart = d.fragment
      ? `${this.moduleKey(d.fragment.module)}@${d.fragment.entryPoint}:${d.fragment.targets
          .map((t) => this.targetKey(t))
          .join(',')}`
      : 'none';
    const primitiveTopology = d.primitive?.topology ?? 'triangle-list';
    const primitiveCull = d.primitive?.cullMode ?? 'none';
    const primitiveFront = d.primitive?.frontFace ?? 'ccw';
    const primitivePart = `${primitiveTopology}/${primitiveCull}/${primitiveFront}`;
    const depthPart = this.depthStencilKey(d.depthStencil);
    return `${layoutPart}|${vertexPart}|${fragmentPart}|${primitivePart}|${depthPart}`;
  }

  private vertexBuffersKey(buffers: RenderPipelineDescriptor['vertex']['buffers']): string {
    if (!buffers || buffers.length === 0) return 'no-vbuf';
    return buffers
      .map((b) => {
        const step = b.stepMode ?? 'vertex';
        const attrs = b.attributes
          .map((a) => `${a.shaderLocation}:${a.format}@${a.offset}`)
          .join(';');
        return `${b.arrayStride}/${step}/${attrs}`;
      })
      .join('+');
  }

  private targetKey(target: { format: string; blend?: unknown; writeMask?: number }): string {
    const blend = target.blend as
      | undefined
      | {
          color: { operation?: string; srcFactor?: string; dstFactor?: string };
          alpha: { operation?: string; srcFactor?: string; dstFactor?: string };
        };
    const blendPart = blend
      ? `${blend.color.operation ?? 'add'}/${blend.color.srcFactor ?? 'one'}/${blend.color.dstFactor ?? 'zero'}` +
        `~${blend.alpha.operation ?? 'add'}/${blend.alpha.srcFactor ?? 'one'}/${blend.alpha.dstFactor ?? 'zero'}`
      : 'no-blend';
    const writeMask = target.writeMask ?? 0xf;
    return `${target.format}^${blendPart}^${writeMask}`;
  }

  private depthStencilKey(ds: RenderPipelineDescriptor['depthStencil']): string {
    if (!ds) return 'no-ds';
    const front = ds.stencilFront ?? {};
    const back = ds.stencilBack ?? {};
    const stencilFront = `${front.compare ?? 'always'}/${front.failOp ?? 'keep'}/${front.depthFailOp ?? 'keep'}/${front.passOp ?? 'keep'}`;
    const stencilBack = `${back.compare ?? 'always'}/${back.failOp ?? 'keep'}/${back.depthFailOp ?? 'keep'}/${back.passOp ?? 'keep'}`;
    return (
      `${ds.format}` +
      `:dw=${ds.depthWriteEnabled ?? true}` +
      `:dc=${ds.depthCompare ?? 'less'}` +
      `:sf=${stencilFront}` +
      `:sb=${stencilBack}` +
      `:srm=${ds.stencilReadMask ?? 0xffffffff}` +
      `:swm=${ds.stencilWriteMask ?? 0xffffffff}` +
      `:db=${ds.depthBias ?? 0}/${ds.depthBiasSlopeScale ?? 0}/${ds.depthBiasClamp ?? 0}`
    );
  }

  private moduleKey(module: ShaderModule): string {
    const hash = this.moduleHashes.get(module);
    if (hash !== undefined) return `S:${hash}`;
    return `S?:${this.fallbackKey(module)}`;
  }

  private layoutKey(layout: PipelineLayout): string {
    let id = this.layoutIds.get(layout);
    if (id !== undefined) return id;
    id = `L${this.nextLayoutId++}`;
    this.layoutIds.set(layout, id);
    return id;
  }

  private fallbackKey(obj: object): string {
    let id = this.fallbackIds.get(obj);
    if (id !== undefined) return id;
    id = `F${this.nextFallbackId++}`;
    this.fallbackIds.set(obj, id);
    return id;
  }
}
