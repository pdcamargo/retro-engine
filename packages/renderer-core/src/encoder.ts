import type { BindGroup } from './binding';
import type { ClearColor, IndexFormat } from './formats';
import type { RenderPipeline } from './pipeline';
import type { Buffer, TextureView } from './resources';

/**
 * Records GPU commands. Encoders are short-lived; one per frame is typical.
 *
 * After {@link CommandEncoder.finish}, the encoder is unusable and must be
 * discarded.
 */
export interface CommandEncoder {
  beginRenderPass(descriptor: RenderPassDescriptor): RenderPassEncoder;
  /** Finalize recording and produce a buffer ready for submission. The encoder is unusable after this. */
  finish(): CommandBuffer;
}

/**
 * Records draws and state changes inside one render pass.
 *
 * The encoder is valid only between `beginRenderPass` and {@link RenderPassEncoder.end} —
 * do not retain it across passes or frames.
 */
export interface RenderPassEncoder {
  setPipeline(pipeline: RenderPipeline): void;
  setBindGroup(index: number, group: BindGroup): void;
  /**
   * Bind a vertex buffer to a slot declared in the pipeline's vertex layout.
   *
   * `offset` defaults to 0; `size` defaults to "rest of buffer." Both are in
   * bytes. The buffer must have been created with `BufferUsage.VERTEX`.
   */
  setVertexBuffer(slot: number, buffer: Buffer, offset?: number, size?: number): void;
  /**
   * Bind an index buffer for {@link RenderPassEncoder.drawIndexed}.
   *
   * `format` selects the per-index width (`uint16` or `uint32`). `offset` is
   * the byte offset into the buffer; `size` is the byte length to use (defaults
   * to the rest of the buffer). The buffer must have been created with
   * `BufferUsage.INDEX`.
   */
  setIndexBuffer(buffer: Buffer, format: IndexFormat, offset?: number, size?: number): void;
  /**
   * Issue a non-indexed draw.
   *
   * `firstVertex` and `firstInstance` default to 0; `instanceCount` defaults
   * to 1.
   */
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
  /**
   * Issue an indexed draw against the buffer most recently bound with
   * {@link RenderPassEncoder.setIndexBuffer}.
   *
   * `firstIndex`, `baseVertex`, and `firstInstance` default to 0;
   * `instanceCount` defaults to 1. `baseVertex` is added to every index read
   * from the index buffer — used by the mesh allocator to point one slab-shared
   * index range at the right vertex slice without rewriting indices.
   */
  drawIndexed(
    indexCount: number,
    instanceCount?: number,
    firstIndex?: number,
    baseVertex?: number,
    firstInstance?: number,
  ): void;
  end(): void;
}

/** A finished, submittable batch of GPU commands. */
export interface CommandBuffer {
  destroy(): void;
}

export interface RenderPassDescriptor {
  label?: string;
  colorAttachments: readonly ColorAttachment[];
  /**
   * Optional depth-stencil attachment. Required when any pipeline used in the
   * pass declares a {@link DepthStencilState}.
   */
  depthStencilAttachment?: DepthStencilAttachment;
}

export interface ColorAttachment {
  /** Where this attachment writes — typically a surface view or render-target view. */
  view: TextureView;
  loadOp: 'load' | 'clear';
  storeOp: 'store' | 'discard';
  /** Color used when `loadOp === 'clear'`. Defaults to transparent black if omitted. */
  clearValue?: ClearColor;
}

/**
 * Depth-stencil attachment for a render pass.
 *
 * Today only the depth side is exposed; stencil load/store ops land with a
 * stencil-using consumer.
 */
export interface DepthStencilAttachment {
  /** Depth (or depth-stencil) texture view. Must have a depth aspect. */
  view: TextureView;
  /** Initial depth value when `depthLoadOp === 'clear'`. Defaults to 1.0. */
  depthClearValue?: number;
  depthLoadOp: 'load' | 'clear';
  depthStoreOp: 'store' | 'discard';
  /** When the attached view also has a stencil aspect that the pipeline doesn't use. */
  depthReadOnly?: boolean;
}
