import type {
  RenderPipelineDescriptor,
  TextureFormat,
  VertexBufferLayout,
} from '@retro-engine/renderer-core';

import type { BindGroupSchema } from '../material/bind-group-schema';
import type { Material, ShaderRef } from '../material/material';

/**
 * Material2d — the consumer-facing trait for a class that contributes a draw
 * to a `Mesh2d` entity. Structurally identical to {@link Material}; the split
 * is at the static surface ({@link Material2dCtor}) so the engine can route
 * 2D specialization keys ({@link MaterialPipelineKey2d}) without depth bias
 * or per-stage normal bookkeeping.
 *
 * Instance methods are optional with documented defaults; classes that just
 * want plain opaque rendering can skip them entirely. Materials are picked up
 * by `Material2dPlugin<M>`'s queue, which feeds them into Core2d's phase trio
 * (`Opaque2d` / `AlphaMask2d` / `Transparent2d`).
 *
 * The engine binds `@group(0)` to the view bind group on every camera pass —
 * user material pipelines that need `@group(0)` for their own data are
 * unsupported. Per-entity transforms live at `@group(1)`; material bind
 * groups live at `@group(2)` — identical to the 3D layout, so a shader author
 * porting between Material and Material2d does not have to swap slot numbers.
 */
export interface Material2d extends Material {}

/**
 * Specialization key consumed by `Material2dPlugin<M>` to vary the
 * `RenderPipelineDescriptor` per (camera, mesh, material variant).
 *
 * Core2d has no depth attachment, so the key carries no depth-stencil
 * dimensions. All current 2D-eligible meshes (Rectangle / Circle /
 * RegularPolygon) share one vertex layout, so the key carries no
 * `vertexLayoutDigest` either — add one when a 2D mesh ships with a
 * different attribute set.
 *
 * - `surfaceFormat` — from the camera's resolved target.
 * - `msaaSamples` — from `Camera.msaaSamples` (planned).
 * - `hdr` — from `Camera.hdr`. Picks the color-target format and the
 *   fragment-shader output mode.
 * - `alphaBucket` — derived from `Material.alphaMode()`. Drives the
 *   `Opaque2d` / `AlphaMask2d` / `Transparent2d` phase split and the
 *   pipeline's blend state.
 * - `materialKey` — optional opaque string a material's `specialize()` can
 *   contribute to extend the cache key with its own feature flags.
 */
export interface MaterialPipelineKey2d {
  readonly surfaceFormat: TextureFormat;
  readonly msaaSamples: 1 | 4;
  readonly hdr: boolean;
  readonly alphaBucket: 'opaque' | 'mask' | 'blend';
  readonly materialKey?: string;
}

/**
 * Static surface every Material2d class must provide. Validated at
 * `Material2dPlugin<M>.build()` time. Not encoded as part of the
 * {@link Material2d} instance type because TypeScript does not model static-
 * method polymorphism.
 */
export interface Material2dCtor<M extends Material2d> {
  new (...args: never[]): M;
  readonly name: string;
  readonly bindGroup: BindGroupSchema<M>;
  vertexShader?(): ShaderRef;
  fragmentShader?(): ShaderRef;
  specialize?(
    descriptor: RenderPipelineDescriptor,
    vertexLayout: VertexBufferLayout,
    key: MaterialPipelineKey2d,
  ): void;
}

/**
 * Convenience: stable string form of the alpha bucket for use in cache keys
 * and log messages.
 */
export const alphaBucketKey = (bucket: MaterialPipelineKey2d['alphaBucket']): string =>
  bucket;
