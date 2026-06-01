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

import { AO_TARGET_FORMAT } from './view-ao-targets';

/**
 * Specialization key for the AO pass pipeline. One pipeline per output format —
 * in practice the single `r8unorm` AO target.
 *
 * @internal
 */
export interface AoKey {
  readonly outputFormat: TextureFormat;
}

interface AoSpecializeContext {
  readonly key: AoKey;
}

/**
 * Render-world resource owning the GTAO pass pipeline: a bind-group layout for
 * the depth + normal inputs and the params uniform, a format-keyed pipeline
 * cache, and a per-camera input bind-group cache rebuilt only when one of the
 * bound views changes identity (a resize / target reallocation).
 *
 * Reads depth and normal with `textureLoad` (no sampler), so the layout binds
 * the depth texture as `sampleType: 'depth'` and the normal as `float` with no
 * sampler entry.
 *
 * GPU resource creation is deferred to the first system tick via
 * {@link ensureInitialised} — the renderer's device is undefined until
 * `App.run()` awaits `init()`.
 *
 * @internal
 */
export class AoPipeline {
  inputBindGroupLayout: BindGroupLayout | undefined;
  pipelineLayout: PipelineLayout | undefined;
  shaderModule: ShaderModule | undefined;
  specialized: SpecializedRenderPipelines<AoSpecializeContext> | undefined;

  private readonly bindGroupCache: Map<
    Entity,
    {
      readonly depthView: TextureView;
      readonly normalView: TextureView;
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
    if (pipelineCache === undefined) {
      throw new Error(
        'AoPipeline: PipelineCache resource missing; ShaderPlugin must run before AoPlugin.',
      );
    }
    if (registry === undefined) {
      throw new Error(
        'AoPipeline: ShaderRegistry resource missing; ShaderPlugin must run before AoPlugin.',
      );
    }
    const source = (registry as ShaderRegistry).get('retro_engine::ao_gtao');
    if (source === undefined) {
      throw new Error(
        "AoPipeline: shader module 'retro_engine::ao_gtao' is not registered; AoPlugin must register it on build.",
      );
    }

    this.inputBindGroupLayout = renderer.createBindGroupLayout({
      label: 'ao-input-layout',
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d', multisampled: false },
        },
        {
          binding: 1,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
        { binding: 2, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.pipelineLayout = renderer.createPipelineLayout({
      label: 'ao-pipeline-layout',
      bindGroupLayouts: [this.inputBindGroupLayout],
    });
    this.shaderModule = (pipelineCache as PipelineCache).compileShader(
      new Shader(source, { label: 'retro_engine::ao_gtao' }),
    );
    this.specialized = new SpecializedRenderPipelines<AoSpecializeContext>(
      pipelineCache as PipelineCache,
      (ctx) => this.specialize(ctx),
      (ctx) => `ao|f=${ctx.key.outputFormat}`,
    );
    this.initialised = true;
    return true;
  }

  /**
   * Return (building on first call, re-using thereafter) the per-camera
   * `@group(0)` bind group pairing the depth view, normal view, and params
   * buffer. Rebuilds when any bound resource's identity changes.
   */
  bindGroupFor(
    app: App,
    sourceEntity: Entity,
    depthView: TextureView,
    normalView: TextureView,
    paramsBuffer: Buffer,
  ): BindGroup {
    if (this.inputBindGroupLayout === undefined) {
      throw new Error('AoPipeline.bindGroupFor: pipeline not initialised — call ensureInitialised first.');
    }
    const cached = this.bindGroupCache.get(sourceEntity);
    if (
      cached !== undefined &&
      cached.depthView === depthView &&
      cached.normalView === normalView &&
      cached.paramsBuffer === paramsBuffer
    ) {
      return cached.bindGroup;
    }
    if (cached !== undefined) cached.bindGroup.destroy();
    const bindGroup = app.renderer.createBindGroup({
      label: `ao-input#${sourceEntity}`,
      layout: this.inputBindGroupLayout,
      entries: [
        { binding: 0, resource: depthView },
        { binding: 1, resource: normalView },
        { binding: 2, resource: { buffer: paramsBuffer } },
      ],
    });
    this.bindGroupCache.set(sourceEntity, { depthView, normalView, paramsBuffer, bindGroup });
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
    this.inputBindGroupLayout?.destroy();
    this.pipelineLayout?.destroy();
    this.inputBindGroupLayout = undefined;
    this.pipelineLayout = undefined;
    this.shaderModule = undefined;
    this.specialized = undefined;
    this.initialised = false;
  }

  private specialize(ctx: AoSpecializeContext): RenderPipelineDescriptor {
    return {
      label: `ao|f=${ctx.key.outputFormat}`,
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

/** Output format the AO pipeline specializes for. */
export const AO_PIPELINE_OUTPUT_FORMAT = AO_TARGET_FORMAT;
