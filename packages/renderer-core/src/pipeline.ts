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
 * Stencil and depth-bias fields are all optional and default to "no-op" /
 * "no bias" — a pipeline that omits them all behaves like a plain
 * depth-test + depth-write pipeline.
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
  /**
   * Stencil state for front-facing triangles. Default: all fields no-op
   * (`compare: 'always'`, every op `'keep'`) — observably equivalent to
   * "stencil disabled."
   */
  stencilFront?: StencilFaceState;
  /** Stencil state for back-facing triangles. Default: same as `stencilFront`. */
  stencilBack?: StencilFaceState;
  /** Mask applied to stencil values before comparison. Default `0xFFFFFFFF` (all bits). */
  stencilReadMask?: number;
  /** Mask applied to stencil writes. Default `0xFFFFFFFF` (all bits). */
  stencilWriteMask?: number;
  /**
   * Constant integer added to a fragment's depth value before comparison.
   * Default `0`. Used together with {@link depthBiasSlopeScale} for shadow-map
   * polygon offset.
   */
  depthBias?: number;
  /**
   * Slope-scaled depth bias — multiplied by the maximum depth slope of the
   * polygon and added to the fragment depth. Default `0`. Typically paired
   * with a small constant {@link depthBias}.
   */
  depthBiasSlopeScale?: number;
  /**
   * Maximum (or minimum, when negative) absolute value the combined depth-bias
   * is clamped to. Default `0` (no clamp).
   */
  depthBiasClamp?: number;
}

/**
 * Comparison functions for depth and stencil tests. Mirrors WebGPU's
 * `GPUCompareFunction` string values so they pass through unmodified.
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

/**
 * Operation applied to a stencil value as a fragment passes through the
 * stencil/depth test. Mirrors WebGPU's `GPUStencilOperation` string values.
 */
export type StencilOperation =
  | 'keep'
  | 'zero'
  | 'replace'
  | 'invert'
  | 'increment-clamp'
  | 'decrement-clamp'
  | 'increment-wrap'
  | 'decrement-wrap';

/**
 * Per-face stencil configuration. All four fields default to a no-op state
 * (compare always passes, all ops keep the stored value) — a face state with
 * no fields set is observably identical to "stencil disabled" for that face.
 *
 * Typical write-only stencil prepass: `{ compare: 'always', passOp: 'replace' }`.
 * Typical read-only stencil match: `{ compare: 'equal' }` (ops default to `'keep'`).
 */
export interface StencilFaceState {
  /** Comparison applied between the fragment's stencil reference and the stored value. Default `'always'`. */
  compare?: CompareFunction;
  /** Operation when the stencil test fails. Default `'keep'`. */
  failOp?: StencilOperation;
  /** Operation when the stencil test passes but the depth test fails. Default `'keep'`. */
  depthFailOp?: StencilOperation;
  /** Operation when both stencil and depth tests pass. Default `'keep'`. */
  passOp?: StencilOperation;
}

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
  /**
   * Blend state. Omit (the default) for opaque writes — equivalent to
   * `{ color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
   *    alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' } }`.
   *
   * Canonical premultiplied-alpha transparency:
   * `{ color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
   *    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }`.
   */
  blend?: BlendState;
  /**
   * Bitmask of channels this target writes. Combine values from {@link ColorWrite}.
   * Default `0xF` (all channels). Set to `0` for a depth-only / stencil-only
   * draw against this target.
   */
  writeMask?: ColorWriteFlags;
}

/**
 * Color blend state. Both `color` and `alpha` halves are required when blend
 * is set — WebGPU has no "same blend for both" shorthand. The two halves are
 * applied independently to the (RGB, A) channels of the fragment output.
 */
export interface BlendState {
  color: BlendComponent;
  alpha: BlendComponent;
}

/**
 * One channel-group of a {@link BlendState}. Defaults model "no blend" —
 * `src * one + dst * zero` is the same write a non-blended pipeline produces.
 */
export interface BlendComponent {
  /** Operation combining the scaled source and destination. Default `'add'`. */
  operation?: BlendOperation;
  /** Source factor. Default `'one'`. */
  srcFactor?: BlendFactor;
  /** Destination factor. Default `'zero'`. */
  dstFactor?: BlendFactor;
}

/**
 * How a {@link BlendComponent}'s scaled source and destination are combined.
 * Mirrors WebGPU's `GPUBlendOperation`.
 */
export type BlendOperation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max';

/**
 * Coefficient applied to a blend operand. Mirrors WebGPU's `GPUBlendFactor`
 * minus the dual-source variants (`'src1' / 'one-minus-src1' / 'src1-alpha' /
 * 'one-minus-src1-alpha'`), which require a WebGPU feature flag and have no
 * in-tree consumer.
 */
export type BlendFactor =
  | 'zero'
  | 'one'
  | 'src'
  | 'one-minus-src'
  | 'src-alpha'
  | 'one-minus-src-alpha'
  | 'dst'
  | 'one-minus-dst'
  | 'dst-alpha'
  | 'one-minus-dst-alpha'
  | 'src-alpha-saturated'
  | 'constant'
  | 'one-minus-constant';

/**
 * Color-channel write-mask bits. Combine with bitwise OR to enable a subset:
 * `ColorWrite.RED | ColorWrite.ALPHA` writes red and alpha and leaves green/blue
 * untouched. Numeric values match WebGPU's `GPUColorWrite`.
 */
export const ColorWrite = {
  RED: 0x1,
  GREEN: 0x2,
  BLUE: 0x4,
  ALPHA: 0x8,
  ALL: 0xf,
} as const;

/** A bitmask of one or more {@link ColorWrite} flags. */
export type ColorWriteFlags = number;

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
