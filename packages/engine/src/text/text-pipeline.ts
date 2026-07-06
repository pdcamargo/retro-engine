import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  PipelineLayout,
  Renderer,
  RenderPipelineDescriptor,
  ShaderModule,
  TextureFormat,
} from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage } from '@retro-engine/renderer-core';
import type { AssetIndex, Handle } from '@retro-engine/assets';

import { ViewBindGroupCache } from '../camera/extracted';
import type { App } from '../index';
import type { Image } from '../image/image';
import { RenderImages } from '../image/image-plugin';
import type { RenderImage } from '../image/render-image';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';
import { SpecializedRenderPipelines } from '../shader/specialized-render-pipeline';

import { TEXT_INSTANCE_BYTE_SIZE } from './text-glyph-instance';

/**
 * Specialization key for the text pipeline. Text is always alpha-blended, so
 * (unlike the sprite pipeline) there is no alpha-bucket axis — pipelines vary
 * only on the render-target shape.
 *
 * @internal
 */
export interface TextKey {
  readonly surfaceFormat: TextureFormat;
  readonly msaaSamples: 1 | 4;
  readonly hdr: boolean;
}

/** @internal — key + downstream context the specialize closure consumes. */
export interface TextSpecializeContext {
  readonly key: TextKey;
}

interface CachedAtlasBindGroup {
  readonly bindGroup: BindGroup;
  readonly source: RenderImage;
}

/**
 * Render-world resource owning the engine's built-in MSDF text pipeline.
 *
 * Holds the shared unit-quad vertex/index buffers, a
 * {@link SpecializedRenderPipelines}`<TextKey>` keyed on the render-target
 * shape, and a per-atlas bind-group cache. GPU resources are built lazily on the
 * first system tick (the renderer's device is undefined until `App.run()`).
 *
 * @internal
 */
export class TextPipeline {
  quadVertexBuffer: Buffer | undefined;
  quadIndexBuffer: Buffer | undefined;
  atlasBindGroupLayout: BindGroupLayout | undefined;
  pipelineLayout: PipelineLayout | undefined;
  module: ShaderModule | undefined;
  specialized: SpecializedRenderPipelines<TextSpecializeContext> | undefined;
  private readonly bindGroupCache: Map<AssetIndex, CachedAtlasBindGroup> = new Map();
  private initialised = false;

  /**
   * Lazy GPU-resource bootstrap. Idempotent. Returns `false` when the camera
   * view layout is not allocated yet (no active camera → nothing to draw);
   * throws if `ShaderPlugin` / `CameraPlugin` resources are missing.
   */
  ensureInitialised(app: App): boolean {
    if (this.initialised) return true;
    const renderer = app.renderer;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    const viewBindGroupCache = app.getResource(ViewBindGroupCache);
    if (pipelineCache === undefined) {
      throw new Error(
        'TextPipeline: PipelineCache resource missing; ShaderPlugin must run before TextPlugin.',
      );
    }
    if (registry === undefined) {
      throw new Error(
        'TextPipeline: ShaderRegistry resource missing; ShaderPlugin must run before TextPlugin.',
      );
    }
    if (viewBindGroupCache === undefined) {
      throw new Error(
        'TextPipeline: ViewBindGroupCache resource missing; CameraPlugin must run before TextPlugin.',
      );
    }
    const viewLayout = viewBindGroupCache.layout;
    if (viewLayout === undefined) return false;

    this.quadVertexBuffer = buildQuadVertexBuffer(renderer);
    this.quadIndexBuffer = buildQuadIndexBuffer(renderer);
    this.atlasBindGroupLayout = renderer.createBindGroupLayout({
      label: 'text-atlas-layout',
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
        { binding: 1, visibility: ShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.pipelineLayout = renderer.createPipelineLayout({
      label: 'text-pipeline-layout',
      bindGroupLayouts: [viewLayout, this.atlasBindGroupLayout],
    });
    const source = registry.get('retro_engine::text');
    if (source === undefined) {
      throw new Error(
        "TextPipeline: shader module 'retro_engine::text' is not registered; TextPlugin must register it on build.",
      );
    }
    this.module = pipelineCache.compileShader(new Shader(source, { label: 'retro_engine::text' }));
    this.specialized = new SpecializedRenderPipelines<TextSpecializeContext>(
      pipelineCache,
      (ctx) => this.specialize(ctx),
      (ctx) => `text|f=${ctx.key.surfaceFormat}|m=${ctx.key.msaaSamples}|hdr=${ctx.key.hdr}`,
    );
    this.initialised = true;
    return true;
  }

  /**
   * Look up (or build) a `BindGroup` for a font atlas handle. Returns
   * `undefined` when the renderer has no uploaded texture for it yet — the
   * caller skips the draw for one frame rather than throwing.
   */
  bindGroupFor(
    atlas: Handle<Image>,
    renderImages: RenderImages,
    renderer: Renderer,
  ): BindGroup | undefined {
    const current = renderImages.get(atlas);
    if (current === undefined) return undefined;
    const cached = this.bindGroupCache.get(atlas.index);
    if (cached !== undefined && cached.source === current) return cached.bindGroup;
    if (cached !== undefined) cached.bindGroup.destroy();
    const fresh = renderer.createBindGroup({
      label: `text-atlas#${atlas.index}`,
      layout: this.atlasBindGroupLayout!,
      entries: [
        { binding: 0, resource: current.view },
        { binding: 1, resource: current.sampler },
      ],
    });
    this.bindGroupCache.set(atlas.index, { bindGroup: fresh, source: current });
    return fresh;
  }

  /** Drop every cached bind group + GPU buffer. Tests call this on teardown. */
  dispose(): void {
    for (const { bindGroup } of this.bindGroupCache.values()) bindGroup.destroy();
    this.bindGroupCache.clear();
    this.quadVertexBuffer?.destroy();
    this.quadIndexBuffer?.destroy();
    this.atlasBindGroupLayout?.destroy();
    this.pipelineLayout?.destroy();
    this.quadVertexBuffer = undefined;
    this.quadIndexBuffer = undefined;
    this.atlasBindGroupLayout = undefined;
    this.pipelineLayout = undefined;
    this.initialised = false;
  }

  private specialize(ctx: TextSpecializeContext): RenderPipelineDescriptor {
    return {
      label: 'text',
      layout: this.pipelineLayout!,
      vertex: {
        module: this.module!,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }],
          },
          {
            arrayStride: TEXT_INSTANCE_BYTE_SIZE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, format: 'float32x4', offset: 0 },
              { shaderLocation: 3, format: 'float32x4', offset: 16 },
              { shaderLocation: 4, format: 'float32x4', offset: 32 },
              { shaderLocation: 5, format: 'unorm8x4', offset: 48 },
            ],
          },
        ],
      },
      fragment: {
        module: this.module!,
        entryPoint: 'fs_main',
        targets: [
          {
            format: ctx.key.surfaceFormat,
            blend: {
              color: {
                operation: 'add',
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
              },
              alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    };
  }
}

const QUAD_VERTEX_BYTES = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDEX_BYTES = new Uint16Array([0, 1, 2, 0, 2, 3]);

const buildQuadVertexBuffer = (renderer: Renderer): Buffer => {
  const buffer = renderer.createBuffer({
    label: 'text-quad-vertex',
    size: QUAD_VERTEX_BYTES.byteLength,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  renderer.writeBuffer(buffer, 0, QUAD_VERTEX_BYTES);
  return buffer;
};

const buildQuadIndexBuffer = (renderer: Renderer): Buffer => {
  const buffer = renderer.createBuffer({
    label: 'text-quad-index',
    size: QUAD_INDEX_BYTES.byteLength,
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
  });
  renderer.writeBuffer(buffer, 0, QUAD_INDEX_BYTES);
  return buffer;
};
