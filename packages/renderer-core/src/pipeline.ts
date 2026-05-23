import type { PipelineLayout } from './binding';
import type { TextureFormat } from './formats';
import type { ShaderModule } from './shader';

/** A compiled render pipeline. */
export interface RenderPipeline {
  destroy(): void;
}

/** A compiled compute pipeline. Not yet driven by the HAL; placeholder. */
export interface ComputePipeline {
  destroy(): void;
}

/**
 * Describes the configuration of a render pipeline.
 *
 * The descriptor is small for Phase 1 — vertex + optional fragment, optional
 * topology, layout that's either `'auto'` (renderer infers from shader
 * reflection) or an explicit {@link PipelineLayout}. Vertex buffer layouts,
 * blend state, and depth/stencil grow in later milestones as features earn
 * them.
 */
export interface RenderPipelineDescriptor {
  label?: string;
  /**
   * Pipeline layout. `'auto'` infers from shader reflection; pass an explicit
   * {@link PipelineLayout} when the pipeline needs to share bind groups with
   * others or expose stable binding slots.
   */
  layout?: 'auto' | PipelineLayout;
  vertex: VertexState;
  fragment?: FragmentState;
  primitive?: PrimitiveState;
}

export interface VertexState {
  module: ShaderModule;
  entryPoint: string;
}

export interface FragmentState {
  module: ShaderModule;
  entryPoint: string;
  targets: readonly ColorTargetState[];
}

export interface ColorTargetState {
  format: TextureFormat;
}

export interface PrimitiveState {
  topology?: 'triangle-list' | 'triangle-strip' | 'line-list' | 'line-strip' | 'point-list';
}
