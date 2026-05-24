import type { Aabb } from '@retro-engine/math';
import type {
  IndexFormat,
  PrimitiveTopology,
  VertexBufferLayout,
  VertexFormat,
} from '@retro-engine/renderer-core';
import { vertexFormatByteSize } from '@retro-engine/renderer-core';

import type { MeshVertexAttribute, MeshVertexAttributeId } from './vertex-attribute';

/**
 * Stable, hash-cons'd identity for a vertex-buffer layout.
 *
 * Two meshes with the same attribute set + step mode share the same
 * `MeshVertexBufferLayoutRef` instance. The reference identity is what the
 * pipeline cache uses to dedupe pipelines and what the {@link MeshAllocator}
 * uses to bucket meshes into shared slabs — meshes with different layouts
 * cannot pack into one buffer because their per-vertex strides differ.
 *
 * Build a ref through {@link interMeshVertexBufferLayout}; never construct one
 * by hand.
 */
export interface MeshVertexBufferLayoutRef {
  /** Pipeline-facing vertex-buffer layout: stride, step mode, per-attribute byte offsets. */
  readonly layout: VertexBufferLayout;
  /**
   * The attribute ids backing this layout, in slot order. Matches
   * `layout.attributes` 1:1 — the i-th attribute id corresponds to the i-th
   * `VertexAttribute` (whose `shaderLocation` is `i`).
   */
  readonly attributeIds: readonly MeshVertexAttributeId[];
  /** Per-vertex byte stride (= `layout.arrayStride`). Cached for the allocator. */
  readonly stride: number;
}

const layoutCache = new Map<string, MeshVertexBufferLayoutRef>();

/**
 * Build (or reuse) a {@link MeshVertexBufferLayoutRef} for the given attribute
 * order. The first call for a given `(attributes, stepMode)` tuple builds and
 * caches the ref; subsequent calls return the same instance.
 *
 * `attributes` is the slot order — the i-th attribute binds to
 * `@location(i)` in the shader. Different orders for the same attribute set
 * produce different layouts (the byte offsets differ), so callers that want
 * cross-mesh sharing must use a stable order.
 *
 * Plain numeric ids feed the cache key; attribute identity is stable per
 * {@link MeshAttribute} reference.
 */
export const interMeshVertexBufferLayout = (
  attributes: readonly MeshVertexAttribute[],
  stepMode: 'vertex' | 'instance' = 'vertex',
): MeshVertexBufferLayoutRef => {
  let key = stepMode + ':';
  for (let i = 0; i < attributes.length; i++) {
    const a = attributes[i]!;
    key += `${a.id}/${a.format};`;
  }
  const existing = layoutCache.get(key);
  if (existing !== undefined) return existing;
  let offset = 0;
  const layoutAttributes = attributes.map((a, i) => {
    const entry = {
      shaderLocation: i,
      format: a.format as VertexFormat,
      offset,
    };
    offset += vertexFormatByteSize(a.format);
    return entry;
  });
  const ref: MeshVertexBufferLayoutRef = {
    layout: { arrayStride: offset, stepMode, attributes: layoutAttributes },
    attributeIds: attributes.map((a) => a.id),
    stride: offset,
  };
  layoutCache.set(key, ref);
  return ref;
};

/**
 * Index-buffer info on a {@link RenderMesh}: indexed vs non-indexed, plus the
 * per-index width when indexed. The non-indexed arm corresponds to
 * {@link RenderPassEncoder.draw} (the renderer reads `vertexCount` directly);
 * the indexed arm corresponds to {@link RenderPassEncoder.drawIndexed}.
 */
export type RenderMeshBufferInfo =
  | { readonly kind: 'indexed'; readonly indexCount: number; readonly indexFormat: IndexFormat }
  | { readonly kind: 'non-indexed' };

/**
 * GPU-side representation of a {@link Mesh}.
 *
 * `RenderMesh` deliberately carries no buffer offsets and no buffer handles —
 * the {@link MeshAllocator} owns the bytes and is queried for slices at draw
 * time. This indirection is what lets the allocator pack many meshes into a
 * shared vertex/index buffer (and what makes Phase 13 GPU-driven batching
 * straightforward when it lands).
 *
 * Lives in the render world (per ADR-0019); the {@link MeshPlugin}'s
 * extract+prepare pipeline owns its lifetime.
 */
export interface RenderMesh {
  /** Number of vertices in the source mesh. Equal to `vertexBuffer.length / stride`. */
  readonly vertexCount: number;
  /** Index-buffer info — present + width, or marker that the mesh draws non-indexed. */
  readonly bufferInfo: RenderMeshBufferInfo;
  /** Local-space AABB precomputed at extract time. Used to seed `CalculateBounds`. */
  readonly aabb: Aabb;
  /** Primitive topology the pipeline rasterises. */
  readonly primitiveTopology: PrimitiveTopology;
  /** Vertex-buffer layout this mesh was packed under. Identity-hashed; safe to compare with `===`. */
  readonly layout: MeshVertexBufferLayoutRef;
}
