import type { Entity } from '@retro-engine/ecs';
import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  PipelineLayout,
  Renderer,
  RenderPipeline,
  RenderPipelineDescriptor,
  Sampler,
  ShaderModule,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage } from '@retro-engine/renderer-core';

import { ViewBindGroupCache } from '../camera/extracted';
import type { App } from '../index';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';
import { SpecializedRenderPipelines } from '../shader/specialized-render-pipeline';

import { LIGHT2D_INSTANCE_BYTE_SIZE } from './light-2d-batch';
import type { Light2dCompositeMode } from './light-2d-settings';

/** Format of the per-camera light-accumulation texture. Fixed at `rgba16float` so additive accumulation can exceed `1` per channel. */
export const LIGHT2D_ACCUM_FORMAT: TextureFormat = 'rgba16float';

/**
 * Specialization key for the composite pipeline.
 *
 * - `surfaceFormat` — each camera writes to its own
 *   `view.mainColorTarget.format` (the HDR intermediate when
 *   `Camera.hdr` is true, the camera's final target otherwise; ADR-0048),
 *   and a multi-window App can have cameras hitting different surface
 *   formats simultaneously.
 * - `compositeMode` — selects the matching fragment entry point
 *   (`fs_multiply` / `fs_add` / `fs_screen`), avoiding a per-pixel branch.
 *
 * @internal
 */
export interface Light2dCompositeKey {
  readonly surfaceFormat: TextureFormat;
  readonly compositeMode: Light2dCompositeMode;
}

interface Light2dCompositeSpecializeContext {
  readonly key: Light2dCompositeKey;
}

/**
 * Render-world resource owning the engine's built-in 2D-lighting pipelines.
 *
 * Holds the shared unit-quad vertex / index buffers (consumed by every
 * additive accumulation draw), the bind-group layouts and pipeline layouts
 * for both passes, the fixed-form accumulation pipeline, and a
 * {@link SpecializedRenderPipelines} for the composite pipeline (varies on
 * surface format). The composite pass's per-camera bind group is built via
 * {@link buildCompositeBindGroup} by `prepareLight2dTargets`.
 *
 * GPU resource creation is deferred to the first system tick via
 * {@link ensureInitialised} — the view bind-group layout owned by
 * `CameraPlugin` is allocated only when the first camera is extracted, so
 * the lighting pipeline must defer its own layout setup until that lands.
 *
 * @internal
 */
export class Light2dPipeline {
  // Shared resources.
  quadVertexBuffer: Buffer | undefined;
  quadIndexBuffer: Buffer | undefined;
  sampler: Sampler | undefined;

  // Accumulation pipeline.
  accumulationPipelineLayout: PipelineLayout | undefined;
  accumulationModule: ShaderModule | undefined;
  accumulationPipeline: RenderPipeline | undefined;
  /** `@group(1)` layout: the shadow atlas texture + sampler the accumulation shader samples. */
  shadowAccumBindGroupLayout: BindGroupLayout | undefined;
  /** `@group(2)` layout: the per-camera normal G-buffer + sampler + `(enabled, height)` uniform. */
  normalAccumBindGroupLayout: BindGroupLayout | undefined;

  // Composite pipeline.
  compositeBindGroupLayout: BindGroupLayout | undefined;
  compositePipelineLayout: PipelineLayout | undefined;
  compositeModule: ShaderModule | undefined;
  composite: SpecializedRenderPipelines<Light2dCompositeSpecializeContext> | undefined;

  private initialised = false;

  /**
   * Lazy GPU-resource bootstrap. Idempotent. Returns `false` (and changes
   * nothing) when the camera plugin's view bind-group layout has not yet
   * been allocated — the lighting accumulation pipeline depends on that
   * layout, so it can't be built before the first camera lands.
   */
  ensureInitialised(app: App): boolean {
    if (this.initialised) return true;
    const renderer = app.renderer;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    const viewBindGroupCache = app.getResource(ViewBindGroupCache);
    if (pipelineCache === undefined) {
      throw new Error(
        'Light2dPipeline: PipelineCache resource missing; ShaderPlugin must run before Light2dPlugin.',
      );
    }
    if (registry === undefined) {
      throw new Error(
        'Light2dPipeline: ShaderRegistry resource missing; ShaderPlugin must run before Light2dPlugin.',
      );
    }
    if (viewBindGroupCache === undefined) {
      throw new Error(
        'Light2dPipeline: ViewBindGroupCache resource missing; CameraPlugin must run before Light2dPlugin.',
      );
    }
    const viewLayout = (viewBindGroupCache as ViewBindGroupCache).layout;
    if (viewLayout === undefined) {
      // First-frame race: defer until CameraPlugin's prepareCameras has
      // allocated the layout on a real camera.
      return false;
    }

    this.quadVertexBuffer = buildQuadVertexBuffer(renderer);
    this.quadIndexBuffer = buildQuadIndexBuffer(renderer);
    this.sampler = renderer.createSampler({
      label: 'light2d-composite-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Accumulation: @group(0) is the view uniform; @group(1) is the shared
    // shadow atlas (texture + sampler) sampled by point / spot lights.
    this.shadowAccumBindGroupLayout = renderer.createBindGroupLayout({
      label: 'light2d-shadow-accum-layout',
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
    this.normalAccumBindGroupLayout = renderer.createBindGroupLayout({
      label: 'light2d-normal-accum-layout',
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
        {
          binding: 2,
          visibility: ShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    this.accumulationPipelineLayout = renderer.createPipelineLayout({
      label: 'light2d-accumulation-layout',
      bindGroupLayouts: [viewLayout, this.shadowAccumBindGroupLayout, this.normalAccumBindGroupLayout],
    });
    const accumShader = new Shader(
      getShaderSource(registry as ShaderRegistry, 'retro_engine::light2d_accumulation'),
      { label: 'retro_engine::light2d_accumulation' },
    );
    this.accumulationModule = (pipelineCache as PipelineCache).compileShader(accumShader);
    this.accumulationPipeline = (pipelineCache as PipelineCache).getOrCreateRenderPipeline(
      this.specializeAccumulation(),
    );

    // Composite: @group(0) carries baseColor texture + lightAccum texture +
    // sampler. No view bind group — the fullscreen triangle uses
    // vertex_index, not view-projection.
    this.compositeBindGroupLayout = renderer.createBindGroupLayout({
      label: 'light2d-composite-layout',
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
        {
          binding: 1,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
        {
          binding: 2,
          visibility: ShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });
    this.compositePipelineLayout = renderer.createPipelineLayout({
      label: 'light2d-composite-pipeline-layout',
      bindGroupLayouts: [this.compositeBindGroupLayout],
    });
    const compositeShader = new Shader(
      getShaderSource(registry as ShaderRegistry, 'retro_engine::light2d_composite'),
      { label: 'retro_engine::light2d_composite' },
    );
    this.compositeModule = (pipelineCache as PipelineCache).compileShader(compositeShader);
    this.composite = new SpecializedRenderPipelines<Light2dCompositeSpecializeContext>(
      pipelineCache as PipelineCache,
      (ctx) => this.specializeComposite(ctx),
      (ctx) => `light2d-composite|f=${ctx.key.surfaceFormat}|m=${ctx.key.compositeMode}`,
    );

    this.initialised = true;
    return true;
  }

  /**
   * Build the per-camera composite bind group from this camera's baseColor
   * and lightAccum views plus the shared composite sampler. Called by
   * `prepareLight2dTargets` whenever a camera's targets are first created or
   * are reallocated due to resize / format change.
   */
  buildCompositeBindGroup(
    app: App,
    sourceEntity: Entity,
    baseColorView: TextureView,
    lightAccumView: TextureView,
  ): BindGroup {
    if (this.compositeBindGroupLayout === undefined || this.sampler === undefined) {
      throw new Error(
        'Light2dPipeline.buildCompositeBindGroup: pipeline not initialised — call ensureInitialised first.',
      );
    }
    return app.renderer.createBindGroup({
      label: `light2d-composite#${sourceEntity}`,
      layout: this.compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: baseColorView },
        { binding: 1, resource: lightAccumView },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  /**
   * Build the `@group(1)` bind group the accumulation pass binds to sample the
   * shared shadow atlas. Called by `Light2dShadowState` once the atlas exists.
   */
  buildShadowAccumBindGroup(app: App, atlasView: TextureView, sampler: Sampler): BindGroup {
    if (this.shadowAccumBindGroupLayout === undefined) {
      throw new Error(
        'Light2dPipeline.buildShadowAccumBindGroup: pipeline not initialised — call ensureInitialised first.',
      );
    }
    return app.renderer.createBindGroup({
      label: 'light2d-shadow-accum',
      layout: this.shadowAccumBindGroupLayout,
      entries: [
        { binding: 0, resource: atlasView },
        { binding: 1, resource: sampler },
      ],
    });
  }

  /**
   * Build the `@group(2)` bind group the accumulation pass binds to sample a
   * camera's normal G-buffer (plus the shared sampler + `(enabled, height)`
   * uniform). Called by `prepareLight2dTargets` when a camera's targets are
   * (re)allocated.
   */
  buildNormalAccumBindGroup(
    app: App,
    sourceEntity: Entity,
    normalView: TextureView,
    sampler: Sampler,
    uniformBuffer: Buffer,
  ): BindGroup {
    if (this.normalAccumBindGroupLayout === undefined) {
      throw new Error(
        'Light2dPipeline.buildNormalAccumBindGroup: pipeline not initialised — call ensureInitialised first.',
      );
    }
    return app.renderer.createBindGroup({
      label: `light2d-normal-accum#${sourceEntity}`,
      layout: this.normalAccumBindGroupLayout,
      entries: [
        { binding: 0, resource: normalView },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });
  }

  /** Drop every GPU resource. Tests call this on teardown. */
  dispose(): void {
    this.quadVertexBuffer?.destroy();
    this.quadIndexBuffer?.destroy();
    this.sampler?.destroy();
    this.shadowAccumBindGroupLayout?.destroy();
    this.normalAccumBindGroupLayout?.destroy();
    this.accumulationPipelineLayout?.destroy();
    this.compositeBindGroupLayout?.destroy();
    this.compositePipelineLayout?.destroy();
    this.quadVertexBuffer = undefined;
    this.quadIndexBuffer = undefined;
    this.sampler = undefined;
    this.accumulationPipelineLayout = undefined;
    this.accumulationModule = undefined;
    this.accumulationPipeline = undefined;
    this.shadowAccumBindGroupLayout = undefined;
    this.normalAccumBindGroupLayout = undefined;
    this.compositeBindGroupLayout = undefined;
    this.compositePipelineLayout = undefined;
    this.compositeModule = undefined;
    this.composite = undefined;
    this.initialised = false;
  }

  private specializeAccumulation(): RenderPipelineDescriptor {
    return {
      label: 'light2d-accumulation',
      layout: this.accumulationPipelineLayout!,
      vertex: {
        module: this.accumulationModule!,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }],
          },
          {
            arrayStride: LIGHT2D_INSTANCE_BYTE_SIZE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, format: 'float32x4', offset: 0 },
              { shaderLocation: 3, format: 'float32x4', offset: 16 },
              { shaderLocation: 4, format: 'float32x4', offset: 32 },
              { shaderLocation: 5, format: 'float32', offset: 48 },
              { shaderLocation: 6, format: 'float32', offset: 52 },
            ],
          },
        ],
      },
      fragment: {
        module: this.accumulationModule!,
        entryPoint: 'fs_main',
        targets: [
          {
            format: LIGHT2D_ACCUM_FORMAT,
            blend: {
              color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
              alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
        frontFace: 'ccw',
      },
    };
  }

  private specializeComposite(ctx: Light2dCompositeSpecializeContext): RenderPipelineDescriptor {
    const mode = ctx.key.compositeMode;
    const entryPoint = mode === 'add' ? 'fs_add' : mode === 'screen' ? 'fs_screen' : 'fs_multiply';
    return {
      label: `light2d-composite|f=${ctx.key.surfaceFormat}|m=${mode}`,
      layout: this.compositePipelineLayout!,
      vertex: {
        module: this.compositeModule!,
        entryPoint: 'vs_main',
        // Fullscreen triangle is generated from vertex_index — no vertex buffer.
        buffers: [],
      },
      fragment: {
        module: this.compositeModule!,
        entryPoint,
        targets: [{ format: ctx.key.surfaceFormat }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
        frontFace: 'ccw',
      },
    };
  }
}

const QUAD_VERTEX_BYTES = new Float32Array([
  0, 0,
  1, 0,
  1, 1,
  0, 1,
]);

const QUAD_INDEX_BYTES = new Uint16Array([0, 1, 2, 0, 2, 3]);

const buildQuadVertexBuffer = (renderer: Renderer): Buffer => {
  const buffer = renderer.createBuffer({
    label: 'light2d-quad-vertex',
    size: QUAD_VERTEX_BYTES.byteLength,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  renderer.writeBuffer(buffer, 0, QUAD_VERTEX_BYTES);
  return buffer;
};

const buildQuadIndexBuffer = (renderer: Renderer): Buffer => {
  const buffer = renderer.createBuffer({
    label: 'light2d-quad-index',
    size: QUAD_INDEX_BYTES.byteLength,
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
  });
  renderer.writeBuffer(buffer, 0, QUAD_INDEX_BYTES);
  return buffer;
};

const getShaderSource = (registry: ShaderRegistry, name: string): string => {
  const source = registry.get(name);
  if (source === undefined) {
    throw new Error(
      `Light2dPipeline: shader module '${name}' is not registered; Light2dPlugin must register it on build.`,
    );
  }
  return source;
};
