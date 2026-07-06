import type { Handle, Image, RenderImage, RenderImages } from '@retro-engine/engine';
import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  PipelineLayout,
  Renderer,
  RenderPipeline,
  ShaderModule,
  TextureFormat,
} from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage } from '@retro-engine/renderer-core';

import { UI_IMAGE_BYTE_SIZE, UI_IMAGE_FLOAT_COUNT } from './ui-image-instance';
import { UI_IMAGE_WGSL } from './ui-image.wgsl';

const QUAD_VERTICES = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

/** One contiguous run of image instances sharing a source texture. */
export interface UiImageBatch {
  readonly image: Handle<Image>;
  readonly firstInstance: number;
  readonly count: number;
}

interface CachedImageBindGroup {
  readonly bindGroup: BindGroup;
  readonly source: RenderImage;
}

/**
 * Render-world resource owning the in-game UI image pipeline: the shared unit
 * quad, a growable per-image instance buffer + scratch, the format-specialized
 * textured pipeline, and a per-source-texture bind-group cache. Built lazily on
 * the first frame with a surface.
 */
export class UiImagePipeline {
  quadVertexBuffer: Buffer | undefined;
  quadIndexBuffer: Buffer | undefined;
  imageBindGroupLayout: BindGroupLayout | undefined;
  pipelineLayout: PipelineLayout | undefined;
  shaderModule: ShaderModule | undefined;
  pipeline: RenderPipeline | undefined;
  instanceBuffer: Buffer | undefined;
  instanceCapacity = 0;

  scratchF32: Float32Array = new Float32Array(0);
  scratchU32: Uint32Array = new Uint32Array(0);
  /** Image instances packed for the current frame. */
  count = 0;
  /** Per-texture draw batches for the current frame. */
  readonly batches: UiImageBatch[] = [];

  private readonly bindGroupCache = new Map<number, CachedImageBindGroup>();
  private builtFormat: TextureFormat | undefined;

  ensureInitialised(renderer: Renderer, format: TextureFormat): boolean {
    if (this.builtFormat === format && this.pipeline !== undefined) return true;

    if (this.quadVertexBuffer === undefined) {
      this.quadVertexBuffer = renderer.createBuffer({
        label: 'ui-image-quad-vertex',
        size: QUAD_VERTICES.byteLength,
        usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      });
      renderer.writeBuffer(this.quadVertexBuffer, 0, QUAD_VERTICES);
      this.quadIndexBuffer = renderer.createBuffer({
        label: 'ui-image-quad-index',
        size: QUAD_INDICES.byteLength,
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      });
      renderer.writeBuffer(this.quadIndexBuffer, 0, QUAD_INDICES);
    }

    if (this.imageBindGroupLayout === undefined) {
      this.imageBindGroupLayout = renderer.createBindGroupLayout({
        label: 'ui-image-layout',
        entries: [
          { binding: 0, visibility: ShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
          { binding: 1, visibility: ShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        ],
      });
    }
    if (this.shaderModule === undefined) {
      this.shaderModule = renderer.createShaderModule({ label: 'retro_ui::image', code: UI_IMAGE_WGSL });
    }
    if (this.pipelineLayout === undefined) {
      this.pipelineLayout = renderer.createPipelineLayout({
        label: 'ui-image-pipeline-layout',
        bindGroupLayouts: [this.imageBindGroupLayout],
      });
    }

    this.pipeline?.destroy();
    this.pipeline = renderer.createRenderPipeline({
      label: 'ui-image',
      layout: this.pipelineLayout,
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }] },
          {
            arrayStride: UI_IMAGE_BYTE_SIZE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, format: 'float32x4', offset: 0 },
              { shaderLocation: 2, format: 'float32x4', offset: 16 },
              { shaderLocation: 3, format: 'unorm8x4', offset: 32 },
            ],
          },
        ],
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format,
            blend: {
              color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    });
    this.builtFormat = format;
    return true;
  }

  ensureCapacity(renderer: Renderer, imageCount: number): void {
    if (imageCount <= this.instanceCapacity && this.instanceBuffer !== undefined) return;
    let capacity = this.instanceCapacity > 0 ? this.instanceCapacity : 64;
    while (capacity < imageCount) capacity *= 2;
    this.instanceBuffer?.destroy();
    this.instanceBuffer = renderer.createBuffer({
      label: 'ui-image-instance',
      size: capacity * UI_IMAGE_BYTE_SIZE,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    const buffer = new ArrayBuffer(capacity * UI_IMAGE_FLOAT_COUNT * 4);
    this.scratchF32 = new Float32Array(buffer);
    this.scratchU32 = new Uint32Array(buffer);
    this.instanceCapacity = capacity;
  }

  /** Look up (or build + cache) the bind group for a source image. */
  bindGroupFor(image: Handle<Image>, renderImages: RenderImages, renderer: Renderer): BindGroup | undefined {
    const current = renderImages.get(image);
    if (current === undefined) return undefined;
    const cached = this.bindGroupCache.get(image.index);
    if (cached !== undefined && cached.source === current) return cached.bindGroup;
    if (cached !== undefined) cached.bindGroup.destroy();
    const bindGroup = renderer.createBindGroup({
      label: `ui-image#${image.index}`,
      layout: this.imageBindGroupLayout!,
      entries: [
        { binding: 0, resource: current.view },
        { binding: 1, resource: current.sampler },
      ],
    });
    this.bindGroupCache.set(image.index, { bindGroup, source: current });
    return bindGroup;
  }

  dispose(): void {
    for (const { bindGroup } of this.bindGroupCache.values()) bindGroup.destroy();
    this.bindGroupCache.clear();
    this.quadVertexBuffer?.destroy();
    this.quadIndexBuffer?.destroy();
    this.instanceBuffer?.destroy();
    this.pipeline?.destroy();
    this.pipelineLayout?.destroy();
    this.imageBindGroupLayout?.destroy();
    this.quadVertexBuffer = undefined;
    this.quadIndexBuffer = undefined;
    this.instanceBuffer = undefined;
    this.pipeline = undefined;
    this.pipelineLayout = undefined;
    this.imageBindGroupLayout = undefined;
    this.instanceCapacity = 0;
    this.count = 0;
    this.batches.length = 0;
    this.builtFormat = undefined;
  }
}
