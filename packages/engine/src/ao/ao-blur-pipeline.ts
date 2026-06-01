import type { Entity } from '@retro-engine/ecs';
import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  PipelineLayout,
  RenderPipelineDescriptor,
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
 * Specialization key for the AO blur pipeline. One pipeline per output format —
 * the single `r8unorm` AO target.
 *
 * @internal
 */
export interface AoBlurKey {
  readonly outputFormat: TextureFormat;
}

interface AoBlurSpecializeContext {
  readonly key: AoBlurKey;
}

/**
 * Render-world resource owning the AO denoise (bilateral blur) pass pipeline: a
 * bind-group layout for the raw AO + depth inputs and the shared AO params
 * uniform, a format-keyed pipeline cache, and a per-camera input bind-group
 * cache rebuilt only when a bound view changes identity.
 *
 * @internal
 */
export class AoBlurPipeline {
  inputBindGroupLayout: BindGroupLayout | undefined;
  pipelineLayout: PipelineLayout | undefined;
  shaderModule: ShaderModule | undefined;
  specialized: SpecializedRenderPipelines<AoBlurSpecializeContext> | undefined;

  private readonly bindGroupCache: Map<
    Entity,
    {
      readonly aoView: TextureView;
      readonly depthView: TextureView;
      readonly paramsBuffer: Buffer;
      readonly bindGroup: BindGroup;
    }
  > = new Map();
  private initialised = false;

  ensureInitialised(app: App): boolean {
    if (this.initialised) return true;
    const renderer = app.renderer;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    if (pipelineCache === undefined || registry === undefined) {
      throw new Error('AoBlurPipeline: PipelineCache / ShaderRegistry missing; ShaderPlugin must run before AoPlugin.');
    }
    const source = (registry as ShaderRegistry).get('retro_engine::ao_blur');
    if (source === undefined) {
      throw new Error("AoBlurPipeline: shader module 'retro_engine::ao_blur' is not registered.");
    }

    this.inputBindGroupLayout = renderer.createBindGroupLayout({
      label: 'ao-blur-input-layout',
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
        {
          binding: 1,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d', multisampled: false },
        },
        { binding: 2, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.pipelineLayout = renderer.createPipelineLayout({
      label: 'ao-blur-pipeline-layout',
      bindGroupLayouts: [this.inputBindGroupLayout],
    });
    this.shaderModule = (pipelineCache as PipelineCache).compileShader(
      new Shader(source, { label: 'retro_engine::ao_blur' }),
    );
    this.specialized = new SpecializedRenderPipelines<AoBlurSpecializeContext>(
      pipelineCache as PipelineCache,
      (ctx) => this.specialize(ctx),
      (ctx) => `ao-blur|f=${ctx.key.outputFormat}`,
    );
    this.initialised = true;
    return true;
  }

  bindGroupFor(
    app: App,
    sourceEntity: Entity,
    aoView: TextureView,
    depthView: TextureView,
    paramsBuffer: Buffer,
  ): BindGroup {
    if (this.inputBindGroupLayout === undefined) {
      throw new Error('AoBlurPipeline.bindGroupFor: pipeline not initialised.');
    }
    const cached = this.bindGroupCache.get(sourceEntity);
    if (
      cached !== undefined &&
      cached.aoView === aoView &&
      cached.depthView === depthView &&
      cached.paramsBuffer === paramsBuffer
    ) {
      return cached.bindGroup;
    }
    if (cached !== undefined) cached.bindGroup.destroy();
    const bindGroup = app.renderer.createBindGroup({
      label: `ao-blur-input#${sourceEntity}`,
      layout: this.inputBindGroupLayout,
      entries: [
        { binding: 0, resource: aoView },
        { binding: 1, resource: depthView },
        { binding: 2, resource: { buffer: paramsBuffer } },
      ],
    });
    this.bindGroupCache.set(sourceEntity, { aoView, depthView, paramsBuffer, bindGroup });
    return bindGroup;
  }

  invalidate(sourceEntity: Entity): void {
    const cached = this.bindGroupCache.get(sourceEntity);
    if (cached !== undefined) {
      cached.bindGroup.destroy();
      this.bindGroupCache.delete(sourceEntity);
    }
  }

  dispose(): void {
    for (const entry of this.bindGroupCache.values()) entry.bindGroup.destroy();
    this.bindGroupCache.clear();
    this.inputBindGroupLayout?.destroy();
    this.pipelineLayout?.destroy();
    this.inputBindGroupLayout = undefined;
    this.pipelineLayout = undefined;
    this.shaderModule = undefined;
    this.specialized = undefined;
    this.initialised = false;
  }

  private specialize(ctx: AoBlurSpecializeContext): RenderPipelineDescriptor {
    return {
      label: `ao-blur|f=${ctx.key.outputFormat}`,
      layout: this.pipelineLayout!,
      vertex: { module: this.shaderModule!, entryPoint: 'vs_main', buffers: [] },
      fragment: {
        module: this.shaderModule!,
        entryPoint: 'fs_main',
        targets: [{ format: ctx.key.outputFormat }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    };
  }
}
