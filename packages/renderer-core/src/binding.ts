import type { TextureFormat } from './formats';
import type { Buffer, Sampler, TextureView } from './resources';

/**
 * Bitfield flags describing which shader stages a binding is visible in.
 *
 * Combine with bitwise OR: `ShaderStage.VERTEX | ShaderStage.FRAGMENT`.
 *
 * Numeric values match WebGPU's `GPUShaderStage`.
 */
export const ShaderStage = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
} as const;

/** A bitmask of one or more {@link ShaderStage} flags. */
export type ShaderStageFlags = number;

/**
 * A bind-group layout — the schema for a set of resource bindings that a
 * pipeline references via a {@link PipelineLayout}.
 */
export interface BindGroupLayout {
  destroy(): void;
}

export interface BindGroupLayoutDescriptor {
  label?: string;
  entries: readonly BindGroupLayoutEntry[];
}

/**
 * One slot in a bind-group layout.
 *
 * Exactly one of `buffer` / `sampler` / `texture` / `storageTexture` should
 * be set — backends MAY reject layouts that set zero or multiple.
 */
export interface BindGroupLayoutEntry {
  /** Bind point within the group. */
  binding: number;
  /** Which shader stages can see this binding. */
  visibility: ShaderStageFlags;
  buffer?: BufferBindingLayout;
  sampler?: SamplerBindingLayout;
  texture?: TextureBindingLayout;
  storageTexture?: StorageTextureBindingLayout;
}

export interface BufferBindingLayout {
  type?: 'uniform' | 'storage' | 'read-only-storage';
  hasDynamicOffset?: boolean;
  /** Minimum size hint for static validation; 0 to defer to runtime. */
  minBindingSize?: number;
}

export interface SamplerBindingLayout {
  type?: 'filtering' | 'non-filtering' | 'comparison';
}

export interface TextureBindingLayout {
  sampleType?: 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint';
  viewDimension?: '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
  multisampled?: boolean;
}

export interface StorageTextureBindingLayout {
  access?: 'write-only' | 'read-only' | 'read-write';
  format: TextureFormat;
  viewDimension?: '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
}

/**
 * A pipeline layout — the ordered list of {@link BindGroupLayout}s a pipeline
 * expects to be bound at the matching index when it's used.
 */
export interface PipelineLayout {
  destroy(): void;
}

export interface PipelineLayoutDescriptor {
  label?: string;
  bindGroupLayouts: readonly BindGroupLayout[];
}

/**
 * A bind group — a concrete set of resources matching a {@link BindGroupLayout}.
 */
export interface BindGroup {
  destroy(): void;
}

export interface BindGroupDescriptor {
  label?: string;
  layout: BindGroupLayout;
  entries: readonly BindGroupEntry[];
}

export interface BindGroupEntry {
  binding: number;
  resource: BindingResource;
}

/**
 * A resource bound to a {@link BindGroupEntry}.
 *
 * `BufferBinding` is structural (has a `buffer` field); `Sampler` and
 * `TextureView` are HAL handles distinguished at the backend by their internal
 * type. Backends MUST accept all three forms.
 */
export type BindingResource = BufferBinding | Sampler | TextureView;

export interface BufferBinding {
  buffer: Buffer;
  /** Byte offset into the buffer. Defaults to 0. */
  offset?: number;
  /** Size of the bound range in bytes. Defaults to the rest of the buffer from `offset`. */
  size?: number;
}
