import type { PipelineLayout } from './binding';
import type { TextureFormat, VertexFormat } from './formats';
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
 * reflection) or an explicit {@link PipelineLayout}. Blend state, and
 * depth/stencil grow in later milestones as features earn them.
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
  /**
   * Depth-stencil state. Required when the active render pass declares a
   * depth-stencil attachment; omit for color-only passes (the default).
   */
  depthStencil?: DepthStencilState;
}

/**
 * Depth-stencil state for a render pipeline. Pairs with a render pass's
 * {@link DepthStencilAttachment}: the pipeline's `format` must match the
 * attachment's view format.
 *
 * Today only the depth side is exposed; stencil ops land when a consumer
 * needs them.
 */
export interface DepthStencilState {
  /** Format of the depth (or depth-stencil) attachment this pipeline targets. */
  format: TextureFormat;
  /** Whether the pipeline writes to the depth attachment. Default `true`. */
  depthWriteEnabled?: boolean;
  /**
   * Depth comparison function applied to a fragment's depth against the
   * attachment value. Default `'less'`.
   */
  depthCompare?: CompareFunction;
}

/**
 * Comparison functions for depth tests. Mirrors WebGPU's `GPUCompareFunction`
 * string values so they pass through unmodified.
 */
export type CompareFunction =
  | 'never'
  | 'less'
  | 'equal'
  | 'less-equal'
  | 'greater'
  | 'not-equal'
  | 'greater-equal'
  | 'always';

export interface VertexState {
  module: ShaderModule;
  entryPoint: string;
  /**
   * Vertex-buffer layouts, in slot order.
   *
   * Each entry corresponds to a buffer the consumer will bind via
   * {@link RenderPassEncoder.setVertexBuffer} at the same index. Omit (or pass
   * an empty array) when the shader produces its own vertex positions
   * (e.g. `@builtin(vertex_index)`-driven full-screen triangles).
   */
  buffers?: readonly VertexBufferLayout[];
}

/**
 * Describes one bound vertex buffer's stride and the attributes packed into it.
 */
export interface VertexBufferLayout {
  /** Stride between consecutive vertices, in bytes. */
  arrayStride: number;
  /** Whether the buffer advances per-vertex or per-instance. Defaults to `'vertex'`. */
  stepMode?: VertexStepMode;
  attributes: readonly VertexAttribute[];
}

/**
 * One attribute packed into a vertex buffer.
 *
 * `shaderLocation` matches a `@location(N)` declaration in the vertex shader.
 * `offset` is the byte offset within one vertex's stride at which this
 * attribute starts.
 */
export interface VertexAttribute {
  shaderLocation: number;
  format: VertexFormat;
  offset: number;
}

/**
 * How a vertex buffer advances during a draw.
 *
 * `'vertex'` — one element per vertex (default; matches a typical position /
 * normal / UV layout). `'instance'` — one element per instance, consumed by
 * instanced draws.
 */
export type VertexStepMode = 'vertex' | 'instance';

export interface FragmentState {
  module: ShaderModule;
  entryPoint: string;
  targets: readonly ColorTargetState[];
}

export interface ColorTargetState {
  format: TextureFormat;
}

export interface PrimitiveState {
  topology?: PrimitiveTopology;
  /**
   * Face culling mode. Default `'none'` (every triangle is rasterised).
   * `'back'` is the typical choice for solid 3D meshes with consistent winding.
   */
  cullMode?: CullMode;
  /**
   * Which triangle winding is considered front-facing. Default `'ccw'`
   * (counter-clockwise, matching glTF / WebGPU defaults).
   */
  frontFace?: FrontFace;
}

export type CullMode = 'none' | 'front' | 'back';
export type FrontFace = 'ccw' | 'cw';

/**
 * Geometric primitive a pipeline rasterises.
 *
 * Mirrors WebGPU's `GPUPrimitiveTopology` string values exactly so they pass
 * through unmodified to the WebGPU backend.
 */
export type PrimitiveTopology = 'triangle-list' | 'triangle-strip' | 'line-list' | 'line-strip' | 'point-list';
