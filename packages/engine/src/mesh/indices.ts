import type { IndexFormat } from '@retro-engine/renderer-core';

/**
 * Mesh index buffer. Tagged union over the two GPU-supported index widths.
 *
 * - `u16` — `Uint16Array`, suitable for meshes with up to 65 536 vertices.
 *   Smaller GPU footprint; the default choice for most meshes.
 * - `u32` — `Uint32Array`, for meshes whose vertex count exceeds the `u16`
 *   range. Doubles the index-buffer cost.
 *
 * The two-arm shape lets the renderer pick the right
 * {@link IndexFormat} at draw time without re-reading the data; consumers
 * branch once on `kind` and act on the typed array.
 */
export type Indices = { readonly kind: 'u16'; readonly data: Uint16Array } | { readonly kind: 'u32'; readonly data: Uint32Array };

/** Build a `u16` index buffer. The input is copied if it isn't already a `Uint16Array`. */
export const u16Indices = (data: Uint16Array | ArrayLike<number>): Indices => ({
  kind: 'u16',
  data: data instanceof Uint16Array ? data : new Uint16Array(data),
});

/** Build a `u32` index buffer. The input is copied if it isn't already a `Uint32Array`. */
export const u32Indices = (data: Uint32Array | ArrayLike<number>): Indices => ({
  kind: 'u32',
  data: data instanceof Uint32Array ? data : new Uint32Array(data),
});

/** The {@link IndexFormat} string that matches the union arm. */
export const indicesFormat = (indices: Indices): IndexFormat => (indices.kind === 'u16' ? 'uint16' : 'uint32');

/** Byte-size of one index for the union arm. */
export const indexByteSize = (indices: Indices): number => (indices.kind === 'u16' ? 2 : 4);

/**
 * Number of index values in the buffer. This is the value passed as
 * `indexCount` to {@link RenderPassEncoder.drawIndexed}.
 */
export const indexCount = (indices: Indices): number => indices.data.length;
