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
 * Specialization key for the motion-blur pipeline. One pipeline per output
 * format — in practice the single `rgba16float` intermediate format, but the
 * key mirrors the tonemap pipeline so a multi-window App forks cleanly.
 *
 * @internal
 */
export interface MotionBlurKey {
  readonly outputFormat: TextureFormat;
}

interface MotionBlurSpecializeContext {
  readonly key: MotionBlurKey;
}

/**
 * Render-world resource owning the engine's built-in motion-blur pipeline:
 * shared sampler + bind-group layout, a format-keyed pipeline cache, and a
 * per-camera input bind-group cache rebuilt only when one of the bound views
 * changes identity (a resize / target reallocation).
 *
 * GPU resource creation is deferred to the first system tick via
 * {@link ensureInitialised} — the renderer's device is undefined until
 * `App.run()` awaits `init()`.
 *
 * @internal
 */
export class MotionBlurPipeline {
  inputBindGroupLayout: BindGroupLayout | undefined;
  pipelineLayout: PipelineLayout | undefined;
  sampler: Sampler | undefined;
  shaderModule: ShaderModule | undefined;
  specialized: SpecializedRenderPipelines<MotionBlurSpecializeContext> | undefined;

  private readonly bindGroupCache: Map<
    Entity,
    {
      readonly sceneView: TextureView;
      readonly motionView: TextureView;
      readonly paramsBuffer: Buffer;
      readonly bindGroup: BindGroup;
    }
  > = new Map();
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
        'MotionBlurPipeline: PipelineCache resource missing; ShaderPlugin must run before MotionBlurPlugin.',
      );
    }
    if (registry === undefined) {
      throw new Error(
        'MotionBlurPipeline: ShaderRegistry resource missing; ShaderPlugin must run before MotionBlurPlugin.',
      );
    }
    const source = (registry as ShaderRegistry).get('retro_engine::motion_blur');
    if (source === undefined) {
      throw new Error(
        "MotionBlurPipeline: shader module 'retro_engine::motion_blur' is not registered; MotionBlurPlugin must register it on build.",
      );
    }

    this.sampler = renderer.createSampler({
      label: 'motion-blur-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.inputBindGroupLayout = renderer.createBindGroupLayout({
      label: 'motion-blur-input-layout',
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
        { binding: 3, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.pipelineLayout = renderer.createPipelineLayout({
      label: 'motion-blur-pipeline-layout',
      bindGroupLayouts: [this.inputBindGroupLayout],
    });
    this.shaderModule = (pipelineCache as PipelineCache).compileShader(
      new Shader(source, { label: 'retro_engine::motion_blur' }),
    );
    this.specialized = new SpecializedRenderPipelines<MotionBlurSpecializeContext>(
      pipelineCache as PipelineCache,
      (ctx) => this.specialize(ctx),
      (ctx) => `motion-blur|f=${ctx.key.outputFormat}`,
    );
    this.initialised = true;
    return true;
  }

  /**
   * Return (building on first call, re-using thereafter) the per-camera
   * `@group(0)` bind group pairing the HDR scene view, motion-vector view,
   * shared sampler, and params buffer. Rebuilds when either view's identity
   * changes (a resize / target reallocation).
   */
  bindGroupFor(
    app: App,
    sourceEntity: Entity,
    sceneView: TextureView,
    motionView: TextureView,
    paramsBuffer: Buffer,
  ): BindGroup {
    if (this.inputBindGroupLayout === undefined || this.sampler === undefined) {
      throw new Error(
        'MotionBlurPipeline.bindGroupFor: pipeline not initialised — call ensureInitialised first.',
      );
    }
    const cached = this.bindGroupCache.get(sourceEntity);
    if (
      cached !== undefined &&
      cached.sceneView === sceneView &&
      cached.motionView === motionView &&
      cached.paramsBuffer === paramsBuffer
    ) {
      return cached.bindGroup;
    }
    if (cached !== undefined) cached.bindGroup.destroy();
    const bindGroup = app.renderer.createBindGroup({
      label: `motion-blur-input#${sourceEntity}`,
      layout: this.inputBindGroupLayout,
      entries: [
        { binding: 0, resource: sceneView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: motionView },
        { binding: 3, resource: { buffer: paramsBuffer } },
      ],
    });
    this.bindGroupCache.set(sourceEntity, { sceneView, motionView, paramsBuffer, bindGroup });
    return bindGroup;
  }

  /** Forget a camera's cached bind group. Called when the camera disappears. */
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

  private specialize(ctx: MotionBlurSpecializeContext): RenderPipelineDescriptor {
    return {
      label: `motion-blur|f=${ctx.key.outputFormat}`,
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
