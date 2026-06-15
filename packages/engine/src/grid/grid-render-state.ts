import {
  type BindGroup,
  type BindGroupLayout,
  type Buffer,
  BufferUsage,
  type PipelineLayout,
  type RenderPipeline,
  type RenderPipelineDescriptor,
  ShaderStage,
  type ShaderModule,
  type TextureFormat,
} from '@retro-engine/renderer-core';

import { ViewBindGroupCache } from '../camera/extracted';
import type { App } from '../index';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';
import { SpecializedRenderPipelines } from '../shader/specialized-render-pipeline';

import type { EditorGrid } from './grid-config';

/** Specialization key: one pipeline per target color format and depth format. */
export interface GridPipelineKey {
  readonly colorFormat: TextureFormat;
  /** Depth attachment format, or `null` for a depth-less pass. */
  readonly depthFormat: TextureFormat | null;
}

/** `f32` count of the grid uniform: four `vec4` colors + two `vec4` param blocks. */
const GRID_UNIFORM_FLOATS = 24;
const GRID_UNIFORM_BYTES = GRID_UNIFORM_FLOATS * 4;

/**
 * Render-world resource owning the editor grid pass's GPU state: the config
 * uniform buffer + its `@group(1)` bind group, and the format-specialized
 * pipelines the pass node draws with.
 *
 * The uniform is **view-independent** — it carries only the grid configuration,
 * while the per-camera position and matrices come from the shared `@group(0)`
 * view uniform. That is why a single buffer, written once per frame, serves
 * every editor camera correctly.
 *
 * GPU resource creation is deferred to the first frame via
 * {@link ensureInitialised} — the renderer device and the `@group(0)` view
 * layout do not exist until cameras have prepared.
 *
 * @internal
 */
export class GridRenderState {
  private readonly scratch = new Float32Array(GRID_UNIFORM_FLOATS);
  private uniformBuffer: Buffer | undefined;
  private bindGroupValue: BindGroup | undefined;
  private shaderModule: ShaderModule | undefined;
  private specialized: SpecializedRenderPipelines<GridPipelineKey> | undefined;
  private initialised = false;

  /** The `@group(1)` bind group. Caller must have initialised first. */
  get bindGroup(): BindGroup {
    if (this.bindGroupValue === undefined) {
      throw new Error('GridRenderState.bindGroup: not initialised — call ensureInitialised first.');
    }
    return this.bindGroupValue;
  }

  /**
   * Lazy GPU bootstrap. Idempotent. Returns `false` (changing nothing) until
   * the `@group(0)` view bind-group layout exists — it is allocated by the
   * camera plugin the first time a camera prepares.
   */
  ensureInitialised(app: App): boolean {
    if (this.initialised) return true;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    const viewCache = app.getResource(ViewBindGroupCache);
    if (pipelineCache === undefined) {
      throw new Error('GridRenderState: PipelineCache missing; ShaderPlugin must run before GridPlugin.');
    }
    if (registry === undefined) {
      throw new Error('GridRenderState: ShaderRegistry missing; ShaderPlugin must run before GridPlugin.');
    }
    const viewLayout = viewCache?.layout;
    if (viewLayout === undefined) return false; // No camera has prepared yet; try next frame.
    const source = registry.get('retro_engine::grid');
    if (source === undefined) {
      throw new Error("GridRenderState: shader 'retro_engine::grid' not registered; GridPlugin must register it on build.");
    }

    this.uniformBuffer = app.renderer.createBuffer({
      label: 'editor-grid-uniform',
      size: GRID_UNIFORM_BYTES,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
    const gridLayout: BindGroupLayout = app.renderer.createBindGroupLayout({
      label: 'editor-grid-layout',
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.VERTEX | ShaderStage.FRAGMENT,
          buffer: { type: 'uniform', minBindingSize: GRID_UNIFORM_BYTES },
        },
      ],
    });
    this.bindGroupValue = app.renderer.createBindGroup({
      label: 'editor-grid-bind-group',
      layout: gridLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.shaderModule = pipelineCache.compileShader(new Shader(source, { label: 'retro_engine::grid' }));
    const pipelineLayout = app.renderer.createPipelineLayout({
      label: 'editor-grid-pipeline-layout',
      bindGroupLayouts: [viewLayout, gridLayout],
    });
    this.specialized = new SpecializedRenderPipelines<GridPipelineKey>(
      pipelineCache,
      (key) => this.specialize(key, pipelineLayout),
      (key) => `grid|c=${key.colorFormat}|d=${key.depthFormat ?? 'none'}`,
    );
    this.initialised = true;
    return true;
  }

  /** Upload this frame's grid configuration to the uniform buffer. */
  prepare(app: App, config: EditorGrid): void {
    const s = this.scratch;
    s[0] = config.minorColor.r;
    s[1] = config.minorColor.g;
    s[2] = config.minorColor.b;
    s[3] = config.minorColor.a;
    s[4] = config.majorColor.r;
    s[5] = config.majorColor.g;
    s[6] = config.majorColor.b;
    s[7] = config.majorColor.a;
    s[8] = config.xAxisColor.r;
    s[9] = config.xAxisColor.g;
    s[10] = config.xAxisColor.b;
    s[11] = config.xAxisColor.a;
    s[12] = config.zAxisColor.r;
    s[13] = config.zAxisColor.g;
    s[14] = config.zAxisColor.b;
    s[15] = config.zAxisColor.a;
    // params0: cell size, cells per major division, plane height, extent.
    s[16] = config.cellSize;
    s[17] = config.majorEvery;
    s[18] = config.planeHeight;
    s[19] = config.fadeEnd;
    // params1: fade start, fade end, plane (0 = XZ ground, 1 = XY work plane).
    s[20] = config.fadeStart;
    s[21] = config.fadeEnd;
    s[22] = config.plane === 'xy' ? 1 : 0;
    s[23] = 0;
    app.renderer.writeBuffer(this.uniformBuffer!, 0, s as unknown as BufferSource);
  }

  /** The grid pipeline for a target format / depth mode. Caller must have initialised first. */
  pipeline(key: GridPipelineKey): RenderPipeline {
    if (this.specialized === undefined) {
      throw new Error('GridRenderState.pipeline: not initialised — call ensureInitialised first.');
    }
    return this.specialized.get(key);
  }

  /** Drop GPU resources. Tests call this on teardown. */
  dispose(): void {
    this.uniformBuffer?.destroy();
    this.uniformBuffer = undefined;
    this.bindGroupValue = undefined;
    this.shaderModule = undefined;
    this.specialized = undefined;
    this.initialised = false;
  }

  private specialize(key: GridPipelineKey, pipelineLayout: PipelineLayout): RenderPipelineDescriptor {
    const descriptor: RenderPipelineDescriptor = {
      label: `grid|c=${key.colorFormat}|d=${key.depthFormat ?? 'none'}`,
      layout: pipelineLayout,
      vertex: {
        module: this.shaderModule!,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: this.shaderModule!,
        entryPoint: 'fs_main',
        targets: [
          {
            format: key.colorFormat,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    };
    if (key.depthFormat !== null) {
      // Depth-test against the scene so geometry occludes the grid, but never
      // write depth — the grid is an overlay that must not block later passes.
      //
      // A negative polygon offset (the classic decal bias) pulls the grid
      // slightly toward the camera so it wins the depth test against geometry
      // it is coplanar with — e.g. a ground-plane mesh at the same height —
      // instead of z-fighting and shimmering. The bias is tiny, so objects
      // standing above the plane still occlude the grid normally. The
      // slope-scaled term keeps it stable at grazing angles, where the plane's
      // depth slope across a pixel is largest.
      descriptor.depthStencil = {
        format: key.depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
        depthBias: -1,
        depthBiasSlopeScale: -1.5,
        depthBiasClamp: 0,
      };
    }
    return descriptor;
  }
}
