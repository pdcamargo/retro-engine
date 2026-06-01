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
import { Images } from '../image/images';
import { RenderImages } from '../image/image-plugin';
import type { RenderImage } from '../image/render-image';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';
import { SpecializedRenderPipelines } from '../shader/specialized-render-pipeline';

import { SPRITE_INSTANCE_BYTE_SIZE, type SpriteAlphaBucket } from './sprite-batch';

/**
 * Specialization key for the sprite pipeline. Phase 8.1 varies on the four
 * fields below; pipelines that match across all four share one cached
 * `RenderPipeline`.
 *
 * @internal
 */
export interface SpriteKey {
  readonly surfaceFormat: TextureFormat;
  readonly msaaSamples: 1 | 4;
  readonly hdr: boolean;
  readonly alphaBucket: SpriteAlphaBucket;
}

interface CachedSpriteBindGroup {
  readonly bindGroup: BindGroup;
  /** The `RenderImage` the bind group was built against, for cache invalidation. */
  readonly source: RenderImage;
}

/**
 * Render-world resource owning the engine's built-in sprite pipeline.
 *
 * Holds:
 *
 * - The shared unit-quad vertex buffer (`@vertex` UV in `[0, 1]²`) + index
 *   buffer (4 verts, 6 indices). Same data feeds every sprite draw.
 * - A {@link SpecializedRenderPipelines}`<SpriteKey>` that varies pipelines by
 *   `(surfaceFormat, msaaSamples, hdr, alphaBucket)`.
 * - A per-image bind-group cache so two batches sharing one image share one
 *   `BindGroup`.
 *
 * GPU resource creation is deferred to the first system tick via
 * {@link ensureInitialised} — the renderer's device is undefined until
 * `App.run()` awaits `init()`, which happens after every plugin's `build`
 * runs.
 *
 * @internal
 */
export class SpritePipeline {
  // GPU resources — built on first ensureInitialised.
  quadVertexBuffer: Buffer | undefined;
  quadIndexBuffer: Buffer | undefined;
  imageBindGroupLayout: BindGroupLayout | undefined;
  pipelineLayout: PipelineLayout | undefined;
  vertexModule: ShaderModule | undefined;
  fragmentModule: ShaderModule | undefined;
  specialized: SpecializedRenderPipelines<SpriteSpecializeContext> | undefined;
  private readonly bindGroupCache: Map<AssetIndex, CachedSpriteBindGroup> = new Map();
  private initialised = false;

  /**
   * Lazy GPU-resource bootstrap. Idempotent. Throws if a required engine
   * resource (`PipelineCache`, `ShaderRegistry`, `ViewBindGroupCache.layout`)
   * is missing — those are owned by `ShaderPlugin` / `CameraPlugin` and must
   * be in place before the first sprite frame.
   */
  ensureInitialised(app: App): boolean {
    if (this.initialised) return true;
    const renderer = app.renderer;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    const viewBindGroupCache = app.getResource(ViewBindGroupCache);
    if (pipelineCache === undefined) {
      throw new Error(
        'SpritePipeline: PipelineCache resource missing; ShaderPlugin must run before SpritePlugin.',
      );
    }
    if (registry === undefined) {
      throw new Error(
        'SpritePipeline: ShaderRegistry resource missing; ShaderPlugin must run before SpritePlugin.',
      );
    }
    if (viewBindGroupCache === undefined) {
      throw new Error(
        'SpritePipeline: ViewBindGroupCache resource missing; CameraPlugin must run before SpritePlugin.',
      );
    }
    const viewLayout = (viewBindGroupCache as ViewBindGroupCache).layout;
    if (viewLayout === undefined) {
      // First-frame race: CameraPlugin allocates the view layout in
      // `prepareCameras` on the first active camera. Without a camera there's
      // nothing to draw anyway — defer init to a later tick.
      return false;
    }

    this.quadVertexBuffer = buildQuadVertexBuffer(renderer);
    this.quadIndexBuffer = buildQuadIndexBuffer(renderer);
    this.imageBindGroupLayout = renderer.createBindGroupLayout({
      label: 'sprite-image-layout',
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.FRAGMENT,
          texture: {
            sampleType: 'float',
            viewDimension: '2d',
            multisampled: false,
          },
        },
        {
          binding: 1,
          visibility: ShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });
    this.pipelineLayout = renderer.createPipelineLayout({
      label: 'sprite-pipeline-layout',
      bindGroupLayouts: [viewLayout, this.imageBindGroupLayout],
    });
    const shader = new Shader(getSpriteShaderSource(registry as ShaderRegistry), {
      label: 'retro_engine::sprite',
    });
    const module = (pipelineCache as PipelineCache).compileShader(shader);
    this.vertexModule = module;
    this.fragmentModule = module;
    this.specialized = new SpecializedRenderPipelines<SpriteSpecializeContext>(
      pipelineCache as PipelineCache,
      (ctx) => this.specialize(ctx),
      (ctx) =>
        `sprite|${ctx.key.alphaBucket}|f=${ctx.key.surfaceFormat}|m=${ctx.key.msaaSamples}|hdr=${ctx.key.hdr}`,
    );
    this.initialised = true;
    return true;
  }

  /**
   * Look up (or build) a `BindGroup` for the supplied image handle.
   * `undefined` resolves to `Images.WHITE`. Cache entries are keyed by the
   * resolved handle; entries whose source `RenderImage` no longer matches the
   * current `RenderImages` entry (replaced or removed) are evicted and
   * rebuilt.
   *
   * Returns `undefined` if the renderer has no entry for the resolved handle
   * yet — the caller (queue closure) should skip the draw rather than throw,
   * because the prepare-system ordering guarantees this only happens at most
   * one frame after a fresh image is added.
   */
  bindGroupFor(
    handle: Handle<Image> | undefined,
    images: Images,
    renderImages: RenderImages,
    renderer: Renderer,
  ): BindGroup | undefined {
    const resolved = handle !== undefined ? handle : images.WHITE;
    const current = renderImages.get(resolved);
    if (current === undefined) return undefined;
    const cached = this.bindGroupCache.get(resolved.index);
    if (cached !== undefined && cached.source === current) {
      return cached.bindGroup;
    }
    if (cached !== undefined) cached.bindGroup.destroy();
    const fresh = renderer.createBindGroup({
      label: `sprite-image#${resolved.index}`,
      layout: this.imageBindGroupLayout!,
      entries: [
        { binding: 0, resource: current.view },
        { binding: 1, resource: current.sampler },
      ],
    });
    this.bindGroupCache.set(resolved.index, { bindGroup: fresh, source: current });
    return fresh;
  }

  /** Drop every cached bind group + GPU buffer. Tests call this on teardown. */
  dispose(): void {
    for (const { bindGroup } of this.bindGroupCache.values()) bindGroup.destroy();
    this.bindGroupCache.clear();
    this.quadVertexBuffer?.destroy();
    this.quadIndexBuffer?.destroy();
    this.imageBindGroupLayout?.destroy();
    this.pipelineLayout?.destroy();
    this.quadVertexBuffer = undefined;
    this.quadIndexBuffer = undefined;
    this.imageBindGroupLayout = undefined;
    this.pipelineLayout = undefined;
    this.initialised = false;
  }

  private specialize(ctx: SpriteSpecializeContext): RenderPipelineDescriptor {
    const isTransparent = ctx.key.alphaBucket === 'blend';
    const descriptor: RenderPipelineDescriptor = {
      label: `sprite#${ctx.key.alphaBucket}`,
      layout: this.pipelineLayout!,
      vertex: {
        module: this.vertexModule!,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, format: 'float32x2', offset: 0 },
            ],
          },
          {
            arrayStride: SPRITE_INSTANCE_BYTE_SIZE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, format: 'float32x4', offset: 0 },
              { shaderLocation: 3, format: 'float32x4', offset: 16 },
              { shaderLocation: 4, format: 'float32x2', offset: 32 },
              { shaderLocation: 5, format: 'unorm8x4', offset: 40 },
            ],
          },
        ],
      },
      fragment: {
        module: this.fragmentModule!,
        entryPoint: 'fs_main',
        targets: [
          isTransparent
            ? {
                format: ctx.key.surfaceFormat,
                blend: {
                  color: {
                    operation: 'add',
                    srcFactor: 'src-alpha',
                    dstFactor: 'one-minus-src-alpha',
                  },
                  alpha: {
                    operation: 'add',
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                  },
                },
              }
            : { format: ctx.key.surfaceFormat },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
        frontFace: 'ccw',
      },
    };
    return descriptor;
  }
}

/** @internal — combined key + downstream context the specialize closure consumes. */
export interface SpriteSpecializeContext {
  readonly key: SpriteKey;
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
    label: 'sprite-quad-vertex',
    size: QUAD_VERTEX_BYTES.byteLength,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  renderer.writeBuffer(buffer, 0, QUAD_VERTEX_BYTES);
  return buffer;
};

const buildQuadIndexBuffer = (renderer: Renderer): Buffer => {
  // WebGPU `BufferDescriptor.size` must be a multiple of 4. Six u16 = 12 B,
  // already 4-aligned; the data we write is 12 bytes too.
  const buffer = renderer.createBuffer({
    label: 'sprite-quad-index',
    size: QUAD_INDEX_BYTES.byteLength,
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
  });
  renderer.writeBuffer(buffer, 0, QUAD_INDEX_BYTES);
  return buffer;
};

const getSpriteShaderSource = (registry: ShaderRegistry): string => {
  const source = registry.get('retro_engine::sprite');
  if (source === undefined) {
    throw new Error(
      "SpritePipeline: shader module 'retro_engine::sprite' is not registered; SpritePlugin must register it on build.",
    );
  }
  return source;
};
