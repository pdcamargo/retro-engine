import { vertexFormatByteSize } from '@retro-engine/renderer-core';

import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { RenderSet } from '../render-set';
import { Res, ResMut } from '../system-param';
import { MeshAllocator, MeshAllocatorSettings } from './allocator';
import { calculateBoundsSystem } from './calculate-bounds';
import type { Indices } from './indices';
import type { MeshAssetEvent, MeshHandle } from './meshes';
import { Meshes } from './meshes';
import type { MeshAttributeData } from './mesh';
import type { Mesh } from './mesh';
import type { RenderMesh } from './render-mesh';
import { interMeshVertexBufferLayout } from './render-mesh';

/**
 * Per-frame extract-side queue: the {@link MeshAssetEvent}s the extract system
 * pulls from {@link Meshes.drainPendingChanges} and hands to the prepare
 * system. Cleared at the end of every prepare pass.
 *
 * Inserted by {@link MeshPlugin} as an App resource (resources are App-scoped,
 * not world-scoped, in this engine — see {@link App.insertResource}).
 */
export class ExtractedMeshAssetEvents {
  events: MeshAssetEvent[] = [];
}

/**
 * Map of {@link MeshHandle} → {@link RenderMesh}, populated by the prepare
 * system. Downstream consumers (Phase 7 material draw systems, Phase 8 sprite
 * draw systems) read this to find a mesh's GPU shape, then query the
 * {@link MeshAllocator} for the buffer slices at draw time.
 */
export class RenderMeshes {
  private readonly entries = new Map<MeshHandle, RenderMesh>();

  set(handle: MeshHandle, mesh: RenderMesh): void {
    this.entries.set(handle, mesh);
  }

  get(handle: MeshHandle): RenderMesh | undefined {
    return this.entries.get(handle);
  }

  has(handle: MeshHandle): boolean {
    return this.entries.has(handle);
  }

  delete(handle: MeshHandle): boolean {
    return this.entries.delete(handle);
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

    // Reserved slot in VisibilityPlugin's documented order. The slot anchors
    // the registration position so when `Mesh3d` lands, the auto-AABB writer
    // is already at the right place — see TSDoc on `calculateBoundsSystem`.
    app.addSystem('postUpdate', [], () => {
      calculateBoundsSystem();
    });

    // RenderSet.Extract: drain Meshes' pending-change buffer into the
    // render-side queue. App resources are accessible from any stage, so we
    // don't need `Extract(...)` here — both resources are App-scoped.
    app.addSystem(
      'render',
      [ResMut(Meshes), ResMut(ExtractedMeshAssetEvents)],
      (meshes, queue) => {
        const drained = meshes.drainPendingChanges();
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
              allocator.freeVertex(ev.handle);
              allocator.freeIndex(ev.handle);
              renderMeshes.delete(ev.handle);
              break;
            case 'modified':
              allocator.freeVertex(ev.handle);
              allocator.freeIndex(ev.handle);
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
  handle: MeshHandle,
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
  allocator.allocateVertex(handle, layout, packed as BufferSource);

  let bufferInfo: RenderMesh['bufferInfo'] = { kind: 'non-indexed' };
  const indices = mesh.indices;
  if (indices !== undefined) {
    allocator.allocateIndex(
      handle,
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
