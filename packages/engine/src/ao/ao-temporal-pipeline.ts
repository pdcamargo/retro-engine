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
 * Specialization key for the AO temporal accumulation pipeline. One pipeline per
 * output format — the single `rg16float` history format.
 *
 * @internal
 */
export interface AoTemporalKey {
  readonly outputFormat: TextureFormat;
}

interface AoTemporalSpecializeContext {
  readonly key: AoTemporalKey;
}

/**
 * Render-world resource owning the AO temporal accumulation pass pipeline: the
 * bind-group layout (current AO + history + motion + depth + params + a linear
 * sampler for the reprojected history fetch), a format-keyed pipeline cache, and
 * a per-camera input bind-group cache. The history view flips each frame
 * (ping-pong), so the bind group is rebuilt per frame.
 *
 * @internal
 */
export class AoTemporalPipeline {
  inputBindGroupLayout: BindGroupLayout | undefined;
  pipelineLayout: PipelineLayout | undefined;
  shaderModule: ShaderModule | undefined;
  sampler: Sampler | undefined;
  specialized: SpecializedRenderPipelines<AoTemporalSpecializeContext> | undefined;

  private readonly bindGroupCache: Map<
    Entity,
    {
      readonly aoView: TextureView;
      readonly historyView: TextureView;
      readonly motionView: TextureView;
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
      throw new Error('AoTemporalPipeline: PipelineCache / ShaderRegistry missing; ShaderPlugin must run before AoPlugin.');
    }
    const source = (registry as ShaderRegistry).get('retro_engine::ao_temporal');
    if (source === undefined) {
      throw new Error("AoTemporalPipeline: shader module 'retro_engine::ao_temporal' is not registered.");
    }

    this.sampler = renderer.createSampler({
      label: 'ao-temporal-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    const floatTex = { sampleType: 'float', viewDimension: '2d', multisampled: false } as const;
    this.inputBindGroupLayout = renderer.createBindGroupLayout({
      label: 'ao-temporal-input-layout',
      entries: [
        { binding: 0, visibility: ShaderStage.FRAGMENT, texture: floatTex },
        { binding: 1, visibility: ShaderStage.FRAGMENT, texture: floatTex },
        { binding: 2, visibility: ShaderStage.FRAGMENT, texture: floatTex },
        {
          binding: 3,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d', multisampled: false },
        },
        { binding: 4, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 5, visibility: ShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.pipelineLayout = renderer.createPipelineLayout({
      label: 'ao-temporal-pipeline-layout',
      bindGroupLayouts: [this.inputBindGroupLayout],
    });
    this.shaderModule = (pipelineCache as PipelineCache).compileShader(
      new Shader(source, { label: 'retro_engine::ao_temporal' }),
    );
    this.specialized = new SpecializedRenderPipelines<AoTemporalSpecializeContext>(
      pipelineCache as PipelineCache,
      (ctx) => this.specialize(ctx),
      (ctx) => `ao-temporal|f=${ctx.key.outputFormat}`,
    );
    this.initialised = true;
    return true;
  }

  bindGroupFor(
    app: App,
    sourceEntity: Entity,
    aoView: TextureView,
    historyView: TextureView,
    motionView: TextureView,
    depthView: TextureView,
    paramsBuffer: Buffer,
  ): BindGroup {
    if (this.inputBindGroupLayout === undefined || this.sampler === undefined) {
      throw new Error('AoTemporalPipeline.bindGroupFor: pipeline not initialised.');
    }
    const cached = this.bindGroupCache.get(sourceEntity);
    if (
      cached !== undefined &&
      cached.aoView === aoView &&
      cached.historyView === historyView &&
      cached.motionView === motionView &&
      cached.depthView === depthView &&
      cached.paramsBuffer === paramsBuffer
    ) {
      return cached.bindGroup;
    }
    if (cached !== undefined) cached.bindGroup.destroy();
    const bindGroup = app.renderer.createBindGroup({
      label: `ao-temporal-input#${sourceEntity}`,
      layout: this.inputBindGroupLayout,
      entries: [
        { binding: 0, resource: aoView },
        { binding: 1, resource: historyView },
        { binding: 2, resource: motionView },
        { binding: 3, resource: depthView },
        { binding: 4, resource: { buffer: paramsBuffer } },
        { binding: 5, resource: this.sampler },
      ],
    });
    this.bindGroupCache.set(sourceEntity, {
      aoView,
      historyView,
      motionView,
      depthView,
      paramsBuffer,
      bindGroup,
    });
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

  private specialize(ctx: AoTemporalSpecializeContext): RenderPipelineDescriptor {
    return {
      label: `ao-temporal|f=${ctx.key.outputFormat}`,
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
