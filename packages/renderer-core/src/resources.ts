import type { TextureFormat } from './formats';

/**
 * Bitfield flags describing how a {@link Buffer} will be used.
 *
 * Combine with the bitwise OR operator: `BufferUsage.VERTEX | BufferUsage.COPY_DST`.
 *
 * Numeric values match WebGPU's `GPUBufferUsage` so the WebGPU backend can pass
 * them through unmodified. Other backends translate to their own model.
 */
export const BufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
} as const;

/** A bitmask of one or more {@link BufferUsage} flags. */
export type BufferUsageFlags = number;

/**
 * Bitfield flags describing how a {@link Texture} will be used.
 *
 * Combine with the bitwise OR operator:
 * `TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST`.
 *
 * Numeric values match WebGPU's `GPUTextureUsage`.
 */
export const TextureUsage = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
} as const;

/** A bitmask of one or more {@link TextureUsage} flags. */
export type TextureUsageFlags = number;

/**
 * A GPU buffer. Lifetime is managed by the caller via {@link Buffer.destroy}.
 *
 * Buffers are mutable from the CPU side via {@link Renderer.writeBuffer} when
 * created with `BufferUsage.COPY_DST`.
 */
export interface Buffer {
  /** Allocated size in bytes. */
  readonly size: number;
  /** Usage flags this buffer was created with. */
  readonly usage: BufferUsageFlags;
  destroy(): void;
}

export interface BufferDescriptor {
  /** Size in bytes. Must be > 0 and a multiple of 4 for most usages. */
  size: number;
  /** Bitmask of {@link BufferUsage} flags. */
  usage: BufferUsageFlags;
  label?: string;
  /**
   * If `true`, the buffer is created in a mapped state so its contents can be
   * filled synchronously before first use. Backends that don't support mapped
   * creation may reject this.
   */
  mappedAtCreation?: boolean;
}

/**
 * A GPU texture. 2D by default; other dimensions may be requested via
 * {@link TextureDescriptor.dimension}.
 */
export interface Texture {
  readonly width: number;
  readonly height: number;
  readonly depthOrArrayLayers: number;
  readonly format: TextureFormat;
  readonly mipLevelCount: number;
  readonly sampleCount: number;
  readonly usage: TextureUsageFlags;
  /** Create a view onto this texture. Omit the descriptor for the default view. */
  createView(descriptor?: TextureViewDescriptor): TextureView;
  destroy(): void;
}

export interface TextureDescriptor {
  width: number;
  height: number;
  /** Depth (for 3D) or array-layer count (for 2D arrays / cubes). Defaults to 1. */
  depthOrArrayLayers?: number;
  format: TextureFormat;
  /** Bitmask of {@link TextureUsage} flags. */
  usage: TextureUsageFlags;
  mipLevelCount?: number;
  sampleCount?: number;
  dimension?: '1d' | '2d' | '3d';
  label?: string;
}

/**
 * A view onto a {@link Texture} (or a {@link Surface}'s current swapchain
 * texture). Views describe how a texture is interpreted at bind time — mip
 * range, array slice, aspect.
 */
export interface TextureView {
  destroy(): void;
}

export interface TextureViewDescriptor {
  label?: string;
  format?: TextureFormat;
  dimension?: '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
  aspect?: 'all' | 'stencil-only' | 'depth-only';
  baseMipLevel?: number;
  mipLevelCount?: number;
  baseArrayLayer?: number;
  arrayLayerCount?: number;
}

/**
 * A texture sampler. Describes how shaders sample texels — filtering, address
 * modes, mip selection.
 */
export interface Sampler {
  destroy(): void;
}

export interface SamplerDescriptor {
  label?: string;
  addressModeU?: 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
  addressModeV?: 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
  addressModeW?: 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
  magFilter?: 'nearest' | 'linear';
  minFilter?: 'nearest' | 'linear';
  mipmapFilter?: 'nearest' | 'linear';
  lodMinClamp?: number;
  lodMaxClamp?: number;
  compare?: 'never' | 'less' | 'equal' | 'less-equal' | 'greater' | 'not-equal' | 'greater-equal' | 'always';
  maxAnisotropy?: number;
}

/**
 * Region descriptor for {@link Renderer.writeTexture}.
 *
 * Origin defaults to `(0, 0, 0)` and `aspect` defaults to `'all'` when omitted.
 */
export interface ImageCopyTexture {
  texture: Texture;
  mipLevel?: number;
  origin?: { x?: number; y?: number; z?: number };
  aspect?: 'all' | 'stencil-only' | 'depth-only';
}

export interface ImageDataLayout {
  /** Offset in bytes into the source data where the first row starts. Defaults to 0. */
  offset?: number;
  /** Stride (in bytes) between consecutive rows. Required for textures wider than one block-row. */
  bytesPerRow?: number;
  /** Stride (in rows) between consecutive depth/array layers. */
  rowsPerImage?: number;
}

export interface Extent3D {
  width: number;
  height?: number;
  depthOrArrayLayers?: number;
}
