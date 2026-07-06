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
  /**
   * Set the stencil reference value compared against by the active pipeline's
   * {@link DepthStencilState.stencilFront} / `stencilBack` `compare`. Dynamic
   * state — survives pipeline changes within the same pass.
   */
  setStencilReference(reference: number): void;
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
 * Depth load/store ops are required; stencil load/store ops are optional and
 * are only consulted when the attached view's format has a stencil aspect
 * (`depth24plus-stencil8`, `depth32float-stencil8`, etc.).
 */
export interface DepthStencilAttachment {
  /** Depth (or depth-stencil) texture view. Must have a depth aspect. */
  view: TextureView;
  /** Initial depth value when `depthLoadOp === 'clear'`. Defaults to 1.0. */
  depthClearValue?: number;
  /** Depth load op. Required unless `depthReadOnly` is set (they are mutually exclusive). */
  depthLoadOp?: 'load' | 'clear';
  /** Depth store op. Required unless `depthReadOnly` is set (they are mutually exclusive). */
  depthStoreOp?: 'store' | 'discard';
  /**
   * Depth is read-only for the pass — the existing depth gates fragments but is
   * never written. Mutually exclusive with `depthLoadOp`/`depthStoreOp`: WebGPU
   * forbids setting either when this is true.
   */
  depthReadOnly?: boolean;
  /** Initial stencil value when `stencilLoadOp === 'clear'`. Defaults to 0. */
  stencilClearValue?: number;
  /** Stencil load op. Required when the view has a stencil aspect that the pipeline uses. */
  stencilLoadOp?: 'load' | 'clear';
  /** Stencil store op. Required when the view has a stencil aspect that the pipeline uses. */
  stencilStoreOp?: 'store' | 'discard';
  /** When the attached view has a stencil aspect that the pipeline doesn't write. */
  stencilReadOnly?: boolean;
}
