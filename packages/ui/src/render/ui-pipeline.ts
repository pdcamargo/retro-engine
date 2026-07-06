import type {
  Buffer,
  PipelineLayout,
  Renderer,
  RenderPipeline,
  ShaderModule,
  TextureFormat,
} from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import { UI_INSTANCE_BYTE_SIZE, UI_INSTANCE_FLOAT_COUNT } from './ui-instance';
import { UI_QUAD_WGSL } from './ui-quad.wgsl';

const QUAD_VERTICES = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

/**
 * Render-world resource owning the in-game UI overlay pipeline: the shared unit
 * quad, a growable per-instance buffer + CPU scratch, and the (format-specialized)
 * alpha-blended render pipeline. GPU resources are built lazily on the first
 * frame that has a surface, via {@link ensureInitialised}.
 */
export class UiPipeline {
  quadVertexBuffer: Buffer | undefined;
  quadIndexBuffer: Buffer | undefined;
  pipelineLayout: PipelineLayout | undefined;
  shaderModule: ShaderModule | undefined;
  pipeline: RenderPipeline | undefined;
  instanceBuffer: Buffer | undefined;
  instanceCapacity = 0;

  /** Interleaved scratch the prepare pass packs into before upload. */
  scratchF32: Float32Array = new Float32Array(0);
  scratchU32: Uint32Array = new Uint32Array(0);
  /** Number of quads packed for the current frame. */
  count = 0;

  private builtFormat: TextureFormat | undefined;

  /** Build (once per surface format) the shared buffers, shader, and pipeline. */
  ensureInitialised(renderer: Renderer, format: TextureFormat): boolean {
    if (this.builtFormat === format && this.pipeline !== undefined) return true;

    if (this.quadVertexBuffer === undefined) {
      this.quadVertexBuffer = renderer.createBuffer({
        label: 'ui-quad-vertex',
        size: QUAD_VERTICES.byteLength,
        usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      });
      renderer.writeBuffer(this.quadVertexBuffer, 0, QUAD_VERTICES);
      this.quadIndexBuffer = renderer.createBuffer({
        label: 'ui-quad-index',
        size: QUAD_INDICES.byteLength,
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      });
      renderer.writeBuffer(this.quadIndexBuffer, 0, QUAD_INDICES);
    }

    if (this.shaderModule === undefined) {
      this.shaderModule = renderer.createShaderModule({ label: 'retro_ui::quad', code: UI_QUAD_WGSL });
    }
    if (this.pipelineLayout === undefined) {
      // No bind groups: the instance rect is already in clip space.
      this.pipelineLayout = renderer.createPipelineLayout({ label: 'ui-quad-layout', bindGroupLayouts: [] });
    }

    this.pipeline?.destroy();
    this.pipeline = renderer.createRenderPipeline({
      label: 'ui-quad',
      layout: this.pipelineLayout,
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }] },
          {
            arrayStride: UI_INSTANCE_BYTE_SIZE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, format: 'float32x4', offset: 0 },
              { shaderLocation: 2, format: 'unorm8x4', offset: 16 },
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

  /** Ensure the instance buffer + scratch hold at least `instanceCount` quads. */
  ensureCapacity(renderer: Renderer, instanceCount: number): void {
    if (instanceCount <= this.instanceCapacity && this.instanceBuffer !== undefined) return;
    let capacity = this.instanceCapacity > 0 ? this.instanceCapacity : 64;
    while (capacity < instanceCount) capacity *= 2;
    this.instanceBuffer?.destroy();
    this.instanceBuffer = renderer.createBuffer({
      label: 'ui-quad-instance',
      size: capacity * UI_INSTANCE_BYTE_SIZE,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    const buffer = new ArrayBuffer(capacity * UI_INSTANCE_FLOAT_COUNT * 4);
    this.scratchF32 = new Float32Array(buffer);
    this.scratchU32 = new Uint32Array(buffer);
    this.instanceCapacity = capacity;
  }

  /** Release every GPU resource. Tests call this on teardown. */
  dispose(): void {
    this.quadVertexBuffer?.destroy();
    this.quadIndexBuffer?.destroy();
    this.instanceBuffer?.destroy();
    this.pipeline?.destroy();
    this.pipelineLayout?.destroy();
    this.quadVertexBuffer = undefined;
    this.quadIndexBuffer = undefined;
    this.instanceBuffer = undefined;
    this.pipeline = undefined;
    this.pipelineLayout = undefined;
    this.instanceCapacity = 0;
    this.count = 0;
    this.builtFormat = undefined;
  }
}
