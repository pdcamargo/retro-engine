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

import { TEXT3D_INSTANCE_BYTE_SIZE } from './text-glyph-instance-3d';

/**
 * Specialization key for the world-space text pipeline. Adds a `depthFormat` axis
 * over the 2D key: a 3D camera's transparent pass always carries a depth
 * attachment (for occlusion), so the pipeline must match the camera's depth
 * format; a 2D pass has none.
 *
 * @internal
 */
export interface Text3dKey {
  readonly surfaceFormat: TextureFormat;
  readonly msaaSamples: 1 | 4;
  readonly hdr: boolean;
  readonly depthFormat: TextureFormat | undefined;
}

/** @internal */
export interface Text3dSpecializeContext {
  readonly key: Text3dKey;
}

interface CachedAtlasBindGroup {
  readonly bindGroup: BindGroup;
  readonly source: RenderImage;
}

/**
 * Render-world resource owning the world-space MSDF text pipeline. Mirrors
 * {@link import('./text-pipeline').TextPipeline} but: draws through the Core3d
 * transparent phase (depth-tested, `depthWriteEnabled: false`), uses the 68-byte
 * 3D instance layout, and specializes on the camera depth format.
 *
 * @internal
 */
export class Text3dPipeline {
  quadVertexBuffer: Buffer | undefined;
  quadIndexBuffer: Buffer | undefined;
  atlasBindGroupLayout: BindGroupLayout | undefined;
  pipelineLayout: PipelineLayout | undefined;
  module: ShaderModule | undefined;
  specialized: SpecializedRenderPipelines<Text3dSpecializeContext> | undefined;
  private readonly bindGroupCache: Map<AssetIndex, CachedAtlasBindGroup> = new Map();
  private initialised = false;

  ensureInitialised(app: App): boolean {
    if (this.initialised) return true;
    const renderer = app.renderer;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    const viewBindGroupCache = app.getResource(ViewBindGroupCache);
    if (pipelineCache === undefined) {
      throw new Error('Text3dPipeline: PipelineCache resource missing; ShaderPlugin must run before TextPlugin.');
    }
    if (registry === undefined) {
      throw new Error('Text3dPipeline: ShaderRegistry resource missing; ShaderPlugin must run before TextPlugin.');
    }
    if (viewBindGroupCache === undefined) {
      throw new Error('Text3dPipeline: ViewBindGroupCache resource missing; CameraPlugin must run before TextPlugin.');
    }
    const viewLayout = viewBindGroupCache.layout;
    if (viewLayout === undefined) return false;

    this.quadVertexBuffer = buildQuadVertexBuffer(renderer);
    this.quadIndexBuffer = buildQuadIndexBuffer(renderer);
    this.atlasBindGroupLayout = renderer.createBindGroupLayout({
      label: 'text3d-atlas-layout',
      entries: [
        { binding: 0, visibility: ShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
        { binding: 1, visibility: ShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.pipelineLayout = renderer.createPipelineLayout({
      label: 'text3d-pipeline-layout',
      bindGroupLayouts: [viewLayout, this.atlasBindGroupLayout],
    });
    const source = registry.get('retro_engine::text3d');
    if (source === undefined) {
      throw new Error(
        "Text3dPipeline: shader module 'retro_engine::text3d' is not registered; TextPlugin must register it on build.",
      );
    }
    this.module = pipelineCache.compileShader(new Shader(source, { label: 'retro_engine::text3d' }));
    this.specialized = new SpecializedRenderPipelines<Text3dSpecializeContext>(
      pipelineCache,
      (ctx) => this.specialize(ctx),
      (ctx) =>
        `text3d|f=${ctx.key.surfaceFormat}|m=${ctx.key.msaaSamples}|hdr=${ctx.key.hdr}|df=${ctx.key.depthFormat ?? 'none'}`,
    );
    this.initialised = true;
    return true;
  }

  bindGroupFor(atlas: Handle<Image>, renderImages: RenderImages, renderer: Renderer): BindGroup | undefined {
    const current = renderImages.get(atlas);
    if (current === undefined) return undefined;
    const cached = this.bindGroupCache.get(atlas.index);
    if (cached !== undefined && cached.source === current) return cached.bindGroup;
    if (cached !== undefined) cached.bindGroup.destroy();
    const fresh = renderer.createBindGroup({
      label: `text3d-atlas#${atlas.index}`,
      layout: this.atlasBindGroupLayout!,
      entries: [
        { binding: 0, resource: current.view },
        { binding: 1, resource: current.sampler },
      ],
    });
    this.bindGroupCache.set(atlas.index, { bindGroup: fresh, source: current });
    return fresh;
  }

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

  private specialize(ctx: Text3dSpecializeContext): RenderPipelineDescriptor {
    const descriptor: RenderPipelineDescriptor = {
      label: 'text3d',
      layout: this.pipelineLayout!,
      vertex: {
        module: this.module!,
        entryPoint: 'vs_main',
        buffers: [
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }] },
          {
            arrayStride: TEXT3D_INSTANCE_BYTE_SIZE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, format: 'float32x4', offset: 0 },
              { shaderLocation: 3, format: 'float32x4', offset: 16 },
              { shaderLocation: 4, format: 'float32x4', offset: 32 },
              { shaderLocation: 5, format: 'float32x4', offset: 48 },
              { shaderLocation: 6, format: 'unorm8x4', offset: 64 },
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
              color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    };
    // A 3D transparent pass carries a read-only depth attachment: test against the
    // scene depth (so text is occluded), never write (so overlapping glyphs blend).
    if (ctx.key.depthFormat !== undefined) {
      descriptor.depthStencil = {
        format: ctx.key.depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      };
    }
    return descriptor;
  }
}

const QUAD_VERTEX_BYTES = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDEX_BYTES = new Uint16Array([0, 1, 2, 0, 2, 3]);

const buildQuadVertexBuffer = (renderer: Renderer): Buffer => {
  const buffer = renderer.createBuffer({
    label: 'text3d-quad-vertex',
    size: QUAD_VERTEX_BYTES.byteLength,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  renderer.writeBuffer(buffer, 0, QUAD_VERTEX_BYTES);
  return buffer;
};

const buildQuadIndexBuffer = (renderer: Renderer): Buffer => {
  const buffer = renderer.createBuffer({
    label: 'text3d-quad-index',
    size: QUAD_INDEX_BYTES.byteLength,
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
  });
  renderer.writeBuffer(buffer, 0, QUAD_INDEX_BYTES);
  return buffer;
};
