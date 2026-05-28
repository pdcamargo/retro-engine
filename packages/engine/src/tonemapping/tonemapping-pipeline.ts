import type { Entity } from '@retro-engine/ecs';
import type {
  BindGroup,
  BindGroupLayout,
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

import type { TonemappingMethod } from './tonemapping';

/**
 * Specialization key for the tonemap pipeline. One distinct pipeline per
 * `(outputFormat, method)` pair — the format swap drives the cache to
 * produce one entry per swapchain format the App uses (typically just one,
 * but multi-window Apps with different surface formats fork here), and
 * `method` switches the WGSL fragment entry point between operators.
 *
 * @internal
 */
export interface TonemappingKey {
  readonly outputFormat: TextureFormat;
  readonly method: TonemappingMethod;
}

interface TonemappingSpecializeContext {
  readonly key: TonemappingKey;
}

/**
 * Render-world resource owning the engine's built-in tonemap pipeline.
 *
 * Holds the shared sampler + bind-group layout (consumed by every
 * tonemap draw), a {@link SpecializedRenderPipelines}`<TonemappingKey>`
 * that varies pipelines by output format + operator, and a per-camera
 * input bind-group cache so repeated frames re-use the same bind group
 * when the input HDR view did not change.
 *
 * GPU resource creation is deferred to the first system tick via
 * {@link ensureInitialised} — the renderer's device is undefined until
 * `App.run()` awaits `init()`.
 *
 * @internal
 */
export class TonemappingPipeline {
  inputBindGroupLayout: BindGroupLayout | undefined;
  pipelineLayout: PipelineLayout | undefined;
  sampler: Sampler | undefined;
  shaderModule: ShaderModule | undefined;
  specialized: SpecializedRenderPipelines<TonemappingSpecializeContext> | undefined;

  /**
   * Per-camera input bind-group cache. Keyed by the main-world camera
   * `sourceEntity`. Entry stores the view it was built against; on a
   * subsequent frame we rebuild only when the view object identity flips
   * (i.e. `prepareCameras` reallocated the HDR target).
   */
  private readonly bindGroupCache: Map<
    Entity,
    { readonly view: TextureView; readonly bindGroup: BindGroup }
  > = new Map();
  private initialised = false;

  /**
   * Lazy GPU-resource bootstrap. Idempotent. Returns `false` (and changes
   * nothing) when prerequisites (`PipelineCache`, `ShaderRegistry`) are
   * missing — those are owned by `ShaderPlugin` and must be in place
   * before the first tonemap frame.
   */
  ensureInitialised(app: App): boolean {
    if (this.initialised) return true;
    const renderer = app.renderer;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    if (pipelineCache === undefined) {
      throw new Error(
        'TonemappingPipeline: PipelineCache resource missing; ShaderPlugin must run before TonemappingPlugin.',
      );
    }
    if (registry === undefined) {
      throw new Error(
        'TonemappingPipeline: ShaderRegistry resource missing; ShaderPlugin must run before TonemappingPlugin.',
      );
    }
    const source = (registry as ShaderRegistry).get('retro_engine::tonemapping');
    if (source === undefined) {
      throw new Error(
        "TonemappingPipeline: shader module 'retro_engine::tonemapping' is not registered; TonemappingPlugin must register it on build.",
      );
    }

    this.sampler = renderer.createSampler({
      label: 'tonemapping-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.inputBindGroupLayout = renderer.createBindGroupLayout({
      label: 'tonemapping-input-layout',
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
        {
          binding: 1,
          visibility: ShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });
    this.pipelineLayout = renderer.createPipelineLayout({
      label: 'tonemapping-pipeline-layout',
      bindGroupLayouts: [this.inputBindGroupLayout],
    });
    this.shaderModule = (pipelineCache as PipelineCache).compileShader(
      new Shader(source, { label: 'retro_engine::tonemapping' }),
    );
    this.specialized = new SpecializedRenderPipelines<TonemappingSpecializeContext>(
      pipelineCache as PipelineCache,
      (ctx) => this.specialize(ctx),
      (ctx) => `tonemapping|f=${ctx.key.outputFormat}|m=${ctx.key.method}`,
    );
    this.initialised = true;
    return true;
  }

  /**
   * Return (building on first call, re-using thereafter) the per-camera
   * `@group(0)` bind group that pairs the camera's current HDR
   * intermediate view with the shared filtering sampler. Cache invalidates
   * when the view identity changes — which happens whenever
   * `prepareCameras` reallocates the HDR texture (resize, format flip, or
   * camera toggling `hdr` off then on again).
   */
  bindGroupFor(app: App, sourceEntity: Entity, hdrView: TextureView): BindGroup {
    if (this.inputBindGroupLayout === undefined || this.sampler === undefined) {
      throw new Error(
        'TonemappingPipeline.bindGroupFor: pipeline not initialised — call ensureInitialised first.',
      );
    }
    const cached = this.bindGroupCache.get(sourceEntity);
    if (cached !== undefined && cached.view === hdrView) return cached.bindGroup;
    if (cached !== undefined) cached.bindGroup.destroy();
    const bindGroup = app.renderer.createBindGroup({
      label: `tonemapping-input#${sourceEntity}`,
      layout: this.inputBindGroupLayout,
      entries: [
        { binding: 0, resource: hdrView },
        { binding: 1, resource: this.sampler },
      ],
    });
    this.bindGroupCache.set(sourceEntity, { view: hdrView, bindGroup });
    return bindGroup;
  }

  /** Forget a camera's cached bind group. Called when a camera disappears. */
  invalidate(sourceEntity: Entity): void {
    const cached = this.bindGroupCache.get(sourceEntity);
    if (cached !== undefined) {
      cached.bindGroup.destroy();
      this.bindGroupCache.delete(sourceEntity);
    }
  }

  /** Drop every GPU resource. Tests call this on teardown. */
  dispose(): void {
    for (const entry of this.bindGroupCache.values()) entry.bindGroup.destroy();
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

  private specialize(ctx: TonemappingSpecializeContext): RenderPipelineDescriptor {
    const entryPoint = entryPointFor(ctx.key.method);
    return {
      label: `tonemapping|f=${ctx.key.outputFormat}|m=${ctx.key.method}`,
      layout: this.pipelineLayout!,
      vertex: {
        module: this.shaderModule!,
        entryPoint: 'vs_main',
        // Fullscreen triangle is generated from vertex_index — no vertex buffer.
        buffers: [],
      },
      fragment: {
        module: this.shaderModule!,
        entryPoint,
        targets: [{ format: ctx.key.outputFormat }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
        frontFace: 'ccw',
      },
    };
  }
}

const entryPointFor = (method: TonemappingMethod): string => {
  switch (method) {
    case 'none':
      return 'fs_none';
    case 'reinhard':
      return 'fs_reinhard';
    case 'reinhard_luminance':
      return 'fs_reinhard_luminance';
    case 'aces_fitted':
      return 'fs_aces_fitted';
    case 'agx':
      return 'fs_agx';
    case 'blender_filmic':
      return 'fs_blender_filmic';
    case 'somewhat_boring_display_transform':
      return 'fs_somewhat_boring';
  }
};
