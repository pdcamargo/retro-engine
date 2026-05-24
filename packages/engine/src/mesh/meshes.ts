import type { Mesh } from './mesh';

/**
 * Opaque handle into the {@link Meshes} registry.
 *
 * Branded `number` so plain ids cannot accidentally substitute. Compare with
 * `===`. Stable for the lifetime of the mesh in the registry — `remove`
 * invalidates the handle and reuses the slot for a new add.
 *
 * Pre-asset-system shape: when `@retro-engine/assets` lands, `MeshHandle`
 * folds into the asset system's `Handle<Mesh>`. The branded numeric id is the
 * shape Bevy uses internally for `AssetId<Mesh>`; the upgrade path is
 * structural.
 */
export type MeshHandle = number & { readonly __meshHandle: unique symbol };

const asMeshHandle = (id: number): MeshHandle => id as MeshHandle;

/**
 * Per-frame change buffered by {@link Meshes} for the {@link MeshPlugin}
 * extract system to drain.
 *
 * Mirrors Bevy's `AssetEvent::{Added, Modified, Removed}` semantics so the
 * extract code reads exactly like a Bevy plugin: enumerate events, call
 * `allocator.allocate` or `allocator.free`, build a fresh {@link RenderMesh}.
 */
export type MeshAssetEvent =
  | { readonly kind: 'added'; readonly handle: MeshHandle }
  | { readonly kind: 'modified'; readonly handle: MeshHandle }
  | { readonly kind: 'removed'; readonly handle: MeshHandle };

/**
 * App-level registry mapping {@link MeshHandle}s to {@link Mesh} instances.
 *
 * Inserted as a main-world resource by {@link MeshPlugin}. Gameplay /
 * spawn-time code calls `meshes.add(mesh)` to register a mesh and get back a
 * handle; downstream components hold the handle, not the mesh itself.
 *
 * Internally the registry buffers a per-frame list of lifecycle events
 * (`Added` / `Modified` / `Removed`); the `MeshPlugin`'s extract system
 * drains the buffer once per frame and feeds the events into the
 * {@link MeshAllocator} on the render world. Gameplay code does not read
 * events from this buffer — the only consumer is the engine's extract path.
 *
 * Pre-asset-system shape: when the asset system lands, `Meshes` folds into
 * `AssetServer<Mesh>` and the `MeshAssetEvent` queue becomes the standard
 * Bevy `AssetEvent<Mesh>` channel. Consumer-facing API ergonomics are
 * preserved across the migration: `add` / `get` / `mutate` / `remove` map
 * cleanly to the asset-system equivalents.
 */
export class Meshes {
  private readonly entries = new Map<MeshHandle, Mesh>();
  private nextId = 1;
  private pendingChanges: MeshAssetEvent[] = [];

  /**
   * Register `mesh` under a fresh handle and queue an `Added` event for the
   * next extract pass. Returns the handle; downstream components store it.
   */
  add(mesh: Mesh): MeshHandle {
    const handle = asMeshHandle(this.nextId++);
    this.entries.set(handle, mesh);
    this.pendingChanges.push({ kind: 'added', handle });
    return handle;
  }

  /** Read the mesh behind a handle. Returns `undefined` if the handle was removed. */
  get(handle: MeshHandle): Mesh | undefined {
    return this.entries.get(handle);
  }

  /**
   * Apply `fn` to the mesh behind `handle` (if it exists) and queue a
   * `Modified` event. `fn` may mutate the mesh in place; the registry simply
   * notifies the extract system that the GPU representation is stale.
   *
   * Returns `true` if the handle resolved and `fn` ran; `false` if the handle
   * was unknown (no event is emitted in that case).
   */
  mutate(handle: MeshHandle, fn: (mesh: Mesh) => void): boolean {
    const mesh = this.entries.get(handle);
    if (mesh === undefined) return false;
    fn(mesh);
    this.pendingChanges.push({ kind: 'modified', handle });
    return true;
  }

  /**
   * Drop the mesh behind `handle` and queue a `Removed` event. Idempotent —
   * removing an unknown / already-removed handle is a silent no-op (no event
   * emitted).
   */
  remove(handle: MeshHandle): void {
    if (!this.entries.delete(handle)) return;
    this.pendingChanges.push({ kind: 'removed', handle });
  }

  /** Whether `handle` resolves to a registered mesh. */
  has(handle: MeshHandle): boolean {
    return this.entries.has(handle);
  }

  /** Number of meshes currently registered. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Drain the per-frame change buffer.
   *
   * Returns the queued events (in submission order) and resets the buffer.
   * Only the engine's extract system should call this — gameplay code that
   * needs to observe asset state should query directly. Subsequent calls
   * inside the same frame return an empty array.
   */
  drainPendingChanges(): MeshAssetEvent[] {
    const out = this.pendingChanges;
    this.pendingChanges = [];
    return out;
  }

  /** Enumerate every registered (handle, mesh) pair. Insertion order. */
  *iter(): IterableIterator<readonly [MeshHandle, Mesh]> {
    for (const entry of this.entries) yield entry;
  }
}
