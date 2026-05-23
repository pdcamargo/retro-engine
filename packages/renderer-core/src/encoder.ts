import type { BindGroup } from './binding';
import type { ClearColor } from './formats';
import type { RenderPipeline } from './pipeline';
import type { TextureView } from './resources';

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
  draw(vertexCount: number, instanceCount?: number): void;
  end(): void;
}

/** A finished, submittable batch of GPU commands. */
export interface CommandBuffer {
  destroy(): void;
}

export interface RenderPassDescriptor {
  label?: string;
  colorAttachments: readonly ColorAttachment[];
}

export interface ColorAttachment {
  /** Where this attachment writes — typically a surface view or render-target view. */
  view: TextureView;
  loadOp: 'load' | 'clear';
  storeOp: 'store' | 'discard';
  /** Color used when `loadOp === 'clear'`. Defaults to transparent black if omitted. */
  clearValue?: ClearColor;
}
