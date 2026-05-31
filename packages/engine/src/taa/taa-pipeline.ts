import type { Entity } from '@retro-engine/ecs';
import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  PipelineLayout,
  RenderPipelineDescriptor,
  Sampler,
  ShaderModule,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';
import { ShaderStage } from '@retro-engine/renderer-core';

import type { App } from '../index';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';
import { SpecializedRenderPipelines } from '../shader/specialized-render-pipeline';

/**
 * Specialization key for the TAA resolve pipeline. One pipeline per output
 * format — in practice the single `rgba16float` history format, but the key
 * mirrors the other post pipelines so a multi-window App forks cleanly.
 *
 * @internal
 */
export interface TaaKey {
  readonly outputFormat: TextureFormat;
}

interface TaaSpecializeContext {
  readonly key: TaaKey;
}

interface TaaBindGroupCacheEntry {
  sceneView: TextureView;
  motionView: TextureView;
  paramsBuffer: Buffer;
  /** Bind groups keyed by history view — at most the two ping-pong slots. */
  readonly byHistory: Map<TextureView, BindGroup>;
}

/**
 * Render-world resource owning the engine's built-in TAA resolve pipeline:
 * shared sampler + bind-group layout, a format-keyed pipeline cache, and a
 * per-camera input bind-group cache.
 *
 * Because the history slot flips every frame, the per-camera cache keys its
 * bind groups by history view (at most two), rebuilding them only when a
 * stable input — the scene view, motion view, or params buffer — changes
 * identity (a resize / target reallocation), not every frame.
 *
 * GPU resource creation is deferred to the first system tick via
 * {@link ensureInitialised} — the renderer's device is undefined until
 * `App.run()` awaits `init()`.
 *
 * @internal
 */
export class TaaPipeline {
  inputBindGroupLayout: BindGroupLayout | undefined;
  pipelineLayout: PipelineLayout | undefined;
  sampler: Sampler | undefined;
  shaderModule: ShaderModule | undefined;
  specialized: SpecializedRenderPipelines<TaaSpecializeContext> | undefined;

  private readonly bindGroupCache: Map<Entity, TaaBindGroupCacheEntry> = new Map();
  private initialised = false;

  /**
   * Lazy GPU-resource bootstrap. Idempotent. Throws if `PipelineCache` /
   * `ShaderRegistry` (owned by `ShaderPlugin`) or the registered WGSL module
   * are missing.
   */
  ensureInitialised(app: App): boolean {
    if (this.initialised) return true;
    const renderer = app.renderer;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    if (pipelineCache === undefined) {
      throw new Error(
        'TaaPipeline: PipelineCache resource missing; ShaderPlugin must run before TaaPlugin.',
      );
    }
    if (registry === undefined) {
      throw new Error(
        'TaaPipeline: ShaderRegistry resource missing; ShaderPlugin must run before TaaPlugin.',
      );
    }
    const source = (registry as ShaderRegistry).get('retro_engine::taa');
    if (source === undefined) {
      throw new Error(
        "TaaPipeline: shader module 'retro_engine::taa' is not registered; TaaPlugin must register it on build.",
      );
    }

    this.sampler = renderer.createSampler({
      label: 'taa-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.inputBindGroupLayout = renderer.createBindGroupLayout({
      label: 'taa-input-layout',
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
        { binding: 1, visibility: ShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        {
          binding: 2,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
        {
          binding: 3,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
        { binding: 4, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.pipelineLayout = renderer.createPipelineLayout({
      label: 'taa-pipeline-layout',
      bindGroupLayouts: [this.inputBindGroupLayout],
    });
    this.shaderModule = (pipelineCache as PipelineCache).compileShader(
      new Shader(source, { label: 'retro_engine::taa' }),
    );
    this.specialized = new SpecializedRenderPipelines<TaaSpecializeContext>(
      pipelineCache as PipelineCache,
      (ctx) => this.specialize(ctx),
      (ctx) => `taa|f=${ctx.key.outputFormat}`,
    );
    this.initialised = true;
    return true;
  }

  /**
   * Return (building on first use of a given history slot, re-using thereafter)
   * the per-camera `@group(0)` bind group pairing the scene view, history view,
   * motion-vector view, shared sampler, and params buffer. The history view
   * flips each frame; the other inputs are stable until a resize, at which point
   * the whole per-camera cache is rebuilt.
   */
  bindGroupFor(
    app: App,
    sourceEntity: Entity,
    sceneView: TextureView,
    historyView: TextureView,
    motionView: TextureView,
    paramsBuffer: Buffer,
  ): BindGroup {
    if (this.inputBindGroupLayout === undefined || this.sampler === undefined) {
      throw new Error(
        'TaaPipeline.bindGroupFor: pipeline not initialised — call ensureInitialised first.',
      );
    }
    let entry = this.bindGroupCache.get(sourceEntity);
    if (
      entry === undefined ||
      entry.sceneView !== sceneView ||
      entry.motionView !== motionView ||
      entry.paramsBuffer !== paramsBuffer
    ) {
      if (entry !== undefined) {
        for (const bg of entry.byHistory.values()) bg.destroy();
      }
      entry = { sceneView, motionView, paramsBuffer, byHistory: new Map() };
      this.bindGroupCache.set(sourceEntity, entry);
    }
    const cached = entry.byHistory.get(historyView);
    if (cached !== undefined) return cached;
    const bindGroup = app.renderer.createBindGroup({
      label: `taa-input#${sourceEntity}`,
      layout: this.inputBindGroupLayout,
      entries: [
        { binding: 0, resource: sceneView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: historyView },
        { binding: 3, resource: motionView },
        { binding: 4, resource: { buffer: paramsBuffer } },
      ],
    });
    entry.byHistory.set(historyView, bindGroup);
    return bindGroup;
  }

  /** Forget a camera's cached bind groups. Called when the camera disappears. */
  invalidate(sourceEntity: Entity): void {
    const entry = this.bindGroupCache.get(sourceEntity);
    if (entry !== undefined) {
      for (const bg of entry.byHistory.values()) bg.destroy();
      this.bindGroupCache.delete(sourceEntity);
    }
  }

  /** Drop every GPU resource. Tests call this on teardown. */
  dispose(): void {
    for (const entry of this.bindGroupCache.values()) {
      for (const bg of entry.byHistory.values()) bg.destroy();
    }
    this.bindGroupCache.clear();
    this.sampler?.destroy();
    this.inputBindGroupLayout?.destroy();
    this.pipelineLayout?.destroy();
    this.sampler = undefined;
    this.inputBindGroupLayout = undefined;
    this.pipelineLayout = undefined;
    this.shaderModule = undefined;
    this.specialized = undefined;
    this.initialised = false;
  }

  private specialize(ctx: TaaSpecializeContext): RenderPipelineDescriptor {
    return {
      label: `taa|f=${ctx.key.outputFormat}`,
      layout: this.pipelineLayout!,
      vertex: {
        module: this.shaderModule!,
        entryPoint: 'vs_main',
        buffers: [],
      },
      fragment: {
        module: this.shaderModule!,
        entryPoint: 'fs_main',
        targets: [{ format: ctx.key.outputFormat }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    };
  }
}
