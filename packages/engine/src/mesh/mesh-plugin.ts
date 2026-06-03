import type { AssetEvent, AssetIndex, Handle } from '@retro-engine/assets';
import { asAssetIndex, makeHandle } from '@retro-engine/assets';
import { t } from '@retro-engine/reflect';
import { vertexFormatByteSize } from '@retro-engine/renderer-core';

import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { RenderSet } from '../render-set';
import { Query, Res, ResMut } from '../system-param';
import { NoFrustumCulling } from '../visibility/visibility';
import { MeshAllocator, MeshAllocatorSettings } from './allocator';
import { calculateBoundsSystem } from './calculate-bounds';
import type { Indices } from './indices';
import { Mesh3d } from './mesh-3d';
import { Mesh2d } from './mesh-2d';
import { Meshes } from './meshes';
import type { MeshAttributeData } from './mesh';
import type { Mesh } from './mesh';
import type { RenderMesh } from './render-mesh';
import { interMeshVertexBufferLayout } from './render-mesh';

/**
 * Per-frame extract-side queue: the {@link AssetEvent}s the extract system
 * pulls from {@link Meshes} and hands to the prepare system. Cleared at the end
 * of every prepare pass.
 *
 * Inserted by {@link MeshPlugin} as an App resource (resources are App-scoped,
 * not world-scoped, in this engine — see {@link App.insertResource}).
 */
export class ExtractedMeshAssetEvents {
  events: AssetEvent<Mesh>[] = [];
}

/**
 * Map of mesh {@link AssetIndex} → {@link RenderMesh}, populated by the prepare
 * system. Downstream consumers (material draw systems, sprite draw systems)
 * read this to find a mesh's GPU shape, then query the {@link MeshAllocator}
 * for the buffer slices at draw time. Keyed on `handle.index` so lookups stay
 * numeric on the draw hot path.
 */
export class RenderMeshes {
  private readonly entries = new Map<AssetIndex, RenderMesh>();

  set(handle: Handle<Mesh>, mesh: RenderMesh): void {
    this.entries.set(handle.index, mesh);
  }

  get(handle: Handle<Mesh>): RenderMesh | undefined {
    return this.entries.get(handle.index);
  }

  has(handle: Handle<Mesh>): boolean {
    return this.entries.has(handle.index);
  }

  delete(handle: Handle<Mesh>): boolean {
    return this.entries.delete(handle.index);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Engine-internal plugin owning the mesh data layer.
 *
 * On `build`:
 *
 * - Inserts {@link Meshes} (the main-world mesh registry).
 * - Inserts {@link MeshAllocator} (the page-based slab suballocator over
 *   shared GPU buffers), seeded with the {@link MeshAllocatorSettings}
 *   resource if one was inserted before the plugin ran, or defaults otherwise.
 * - Inserts {@link ExtractedMeshAssetEvents} and {@link RenderMeshes}.
 * - Registers the `'postUpdate'` `calculateBoundsSystem` slot reserved by
 *   `VisibilityPlugin`'s documented order — see {@link calculateBoundsSystem}.
 *   `MeshPlugin` is registered between `CameraPlugin` and `VisibilityPlugin`
 *   in `CorePlugin` so registration order matches the documented system
 *   order.
 * - Registers the `RenderSet.Extract` system that drains pending mesh-asset
 *   events into {@link ExtractedMeshAssetEvents}.
 * - Registers the `RenderSet.Prepare` system that consumes the queue:
 *   allocates GPU storage for added / modified meshes via
 *   {@link MeshAllocator.allocateVertex} / {@link MeshAllocator.allocateIndex},
 *   frees removed / modified handles, and updates {@link RenderMeshes} with
 *   the resulting {@link RenderMesh} entries.
 *
 * Unique — re-adding manually throws.
 */
export class MeshPlugin implements PluginObject {
  name(): string {
    return 'MeshPlugin';
  }

  build(app: App): void {
    if (app.getResource(Meshes) === undefined) app.insertResource(new Meshes());
    if (app.getResource(MeshAllocatorSettings) === undefined) {
      app.insertResource(new MeshAllocatorSettings());
    }
    const settings = app.getResource(MeshAllocatorSettings)!;
    if (app.getResource(MeshAllocator) === undefined) {
      app.insertResource(new MeshAllocator(app.renderer, settings));
    }
    if (app.getResource(ExtractedMeshAssetEvents) === undefined) {
      app.insertResource(new ExtractedMeshAssetEvents());
    }
    if (app.getResource(RenderMeshes) === undefined) {
      app.insertResource(new RenderMeshes());
    }

    // The mesh handle is the only authored state; the visibility/transform
    // companions Mesh3d requires are re-attached on load and recomputed. The
    // explicit make supplies a placeholder handle decode immediately overwrites.
    app.registerComponent(
      Mesh3d,
      { handle: t.handle<Mesh>('Mesh') },
      { name: 'Mesh3d', make: () => new Mesh3d(makeHandle(asAssetIndex(0))) },
    );
    // Mesh2d shares the Meshes store with Mesh3d; same handle wrapper, same key.
    app.registerComponent(
      Mesh2d,
      { handle: t.handle<Mesh>('Mesh') },
      { name: 'Mesh2d', make: () => new Mesh2d(makeHandle(asAssetIndex(0))) },
    );

    // Head of VisibilityPlugin's documented order:
    // `CalculateBounds → UpdateFrusta → VisibilityPropagate → CheckVisibility`.
    // Iterate `Mesh3d` entities without `NoFrustumCulling`, look up the mesh
    // asset, and write a local-space `Aabb` so the frustum test downstream has
    // something to clip against. Change-gated on `Mesh3d`: local bounds only
    // move when geometry does, so an entity is visited on add and on change,
    // not every frame (see calculateBoundsSystem for the in-place-edit caveat).
    app.addSystem(
      'postUpdate',
      [Res(Meshes), Query([Mesh3d], { without: [NoFrustumCulling], changed: [Mesh3d] })],
      (meshes, meshables) => {
        calculateBoundsSystem(meshes, meshables, app.world);
      },
    );

    // RenderSet.Extract: drain Meshes' pending-change buffer into the
    // render-side queue. App resources are accessible from any stage, so we
    // don't need `Extract(...)` here — both resources are App-scoped.
    app.addSystem(
      'render',
      [ResMut(Meshes), ResMut(ExtractedMeshAssetEvents)],
      (meshes, queue) => {
        const drained = meshes.drainEvents();
        if (drained.length === 0) return;
        // Append rather than overwrite so a hypothetical second producer
        // (a plugin queuing synthetic events for hot-reload, etc.) could co-
        // exist. The prepare system clears the queue.
        for (const ev of drained) queue.events.push(ev);
      },
      { set: RenderSet.Extract },
    );

    // RenderSet.Prepare: consume the queue, allocate GPU storage, build
    // RenderMesh, store in RenderMeshes.
    app.addSystem(
      'render',
      [Res(Meshes), ResMut(MeshAllocator), ResMut(ExtractedMeshAssetEvents), ResMut(RenderMeshes)],
      (meshes, allocator, queue, renderMeshes) => {
        if (queue.events.length === 0) return;
        for (const ev of queue.events) {
          switch (ev.kind) {
            case 'removed':
              allocator.freeVertex(ev.handle.index);
              allocator.freeIndex(ev.handle.index);
              renderMeshes.delete(ev.handle);
              break;
            case 'modified':
              allocator.freeVertex(ev.handle.index);
              allocator.freeIndex(ev.handle.index);
              renderMeshes.delete(ev.handle);
              {
                const mesh = meshes.get(ev.handle);
                if (mesh !== undefined) uploadMesh(ev.handle, mesh, allocator, renderMeshes);
              }
              break;
            case 'added': {
              const mesh = meshes.get(ev.handle);
              if (mesh !== undefined) uploadMesh(ev.handle, mesh, allocator, renderMeshes);
              break;
            }
            case 'unused':
              break;
          }
        }
        queue.events.length = 0;
      },
      { set: RenderSet.Prepare },
    );
  }
}

/**
 * Pack one mesh into the allocator + record its {@link RenderMesh}.
 *
 * Attributes are packed in the same order as {@link Mesh.iterAttributes}; the
 * resulting layout is hash-consed by {@link interMeshVertexBufferLayout} so
 * meshes with the same attribute set share a slab.
 */
const uploadMesh = (
  handle: Handle<Mesh>,
  mesh: Mesh,
  allocator: MeshAllocator,
  renderMeshes: RenderMeshes,
): void => {
  const attributeData: MeshAttributeData[] = [];
  for (const data of mesh.iterAttributes()) attributeData.push(data);
  if (attributeData.length === 0) return;
  const first = attributeData[0]!;
  const firstElementSize = vertexFormatByteSize(first.attribute.format);
  const vertexCount = (first.data.byteLength / firstElementSize) | 0;
  const layout = interMeshVertexBufferLayout(attributeData.map((a) => a.attribute));
  const packed = packInterleaved(attributeData, vertexCount, layout.stride);
  allocator.allocateVertex(handle.index, layout, packed as BufferSource);

  let bufferInfo: RenderMesh['bufferInfo'] = { kind: 'non-indexed' };
  const indices = mesh.indices;
  if (indices !== undefined) {
    allocator.allocateIndex(
      handle.index,
      indices.kind === 'u16' ? 'uint16' : 'uint32',
      indicesByteView(indices) as BufferSource,
    );
    bufferInfo = {
      kind: 'indexed',
      indexCount: indices.data.length,
      indexFormat: indices.kind === 'u16' ? 'uint16' : 'uint32',
    };
  }

  renderMeshes.set(handle, {
    vertexCount,
    bufferInfo,
    aabb: mesh.computeAabb(),
    primitiveTopology: mesh.primitiveTopology,
    layout,
  });
};

const packInterleaved = (
  attributeData: readonly MeshAttributeData[],
  vertexCount: number,
  stride: number,
): Uint8Array => {
  const out = new Uint8Array(vertexCount * stride);
  let offset = 0;
  for (const { attribute, data } of attributeData) {
    const elementSize = vertexFormatByteSize(attribute.format);
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < vertexCount; i++) {
      const src = i * elementSize;
      const dst = i * stride + offset;
      for (let b = 0; b < elementSize; b++) out[dst + b] = view[src + b]!;
    }
    offset += elementSize;
  }
  return out;
};

const indicesByteView = (indices: Indices): Uint8Array => {
  const data = indices.data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};
