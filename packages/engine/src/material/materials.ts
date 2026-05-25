import type { Material } from './material';

/**
 * Opaque handle into a {@link Materials} registry.
 *
 * Branded `number` with a phantom material parameter — `MaterialHandle<A>` is
 * not assignable to `MaterialHandle<B>` even when both wrap the same numeric
 * id. The phantom binding is type-only; runtime is just a number.
 *
 * Pre-asset-system shape: when `@retro-engine/assets` lands, `MaterialHandle`
 * folds into the asset system's `Handle<M>`. The branded numeric id is the
 * shape Bevy uses internally for `AssetId<M>`; the upgrade path is
 * structural.
 */
export type MaterialHandle<M extends Material> = number & {
  readonly __materialHandle: unique symbol;
  readonly __material: M;
};

/**
 * Per-frame change buffered by {@link Materials} for the
 * `MaterialPlugin<M>` extract system to drain.
 *
 * Mirrors Bevy's `AssetEvent::{Added, Modified, Removed}` semantics one-for-one
 * with the parallel {@link MeshAssetEvent} shape.
 */
export type MaterialAssetEvent<M extends Material> =
  | { readonly kind: 'added'; readonly handle: MaterialHandle<M> }
  | { readonly kind: 'modified'; readonly handle: MaterialHandle<M> }
  | { readonly kind: 'removed'; readonly handle: MaterialHandle<M> };

/**
 * App-level registry mapping {@link MaterialHandle}s to material instances of
 * type `M`.
 *
 * Inserted as a main-world resource by `MaterialPlugin<M>`. Gameplay /
 * spawn-time code calls `materials.add(material)` to register a material and
 * gets back a handle; `MeshMaterial3d<M>` components hold the handle.
 *
 * Internally the registry buffers a per-frame list of lifecycle events
 * (`Added` / `Modified` / `Removed`); the plugin's extract system drains the
 * buffer once per frame and forwards events into the render world.
 *
 * One `Materials<M>` per material type. The plugin enforces uniqueness at
 * `build()` — instantiating two `MaterialPlugin<StandardMaterial>` throws.
 *
 * Pre-asset-system shape: when the asset system lands, `Materials` folds into
 * `AssetServer<M>` and the `MaterialAssetEvent` queue becomes the standard
 * Bevy `AssetEvent<M>` channel. Consumer-facing API ergonomics are preserved
 * across the migration: `add` / `get` / `mutate` / `remove` map cleanly to
 * the asset-system equivalents. The class is generic over `M` here so the
 * fold lands without source-level changes to user code.
 */
export class Materials<M extends Material> {
  private readonly entries = new Map<MaterialHandle<M>, M>();
  private nextId = 1;
  private pendingChanges: MaterialAssetEvent<M>[] = [];

  /**
   * Register `material` under a fresh handle and queue an `Added` event for
   * the next extract pass.
   */
  add(material: M): MaterialHandle<M> {
    const handle = this.nextId++ as unknown as MaterialHandle<M>;
    this.entries.set(handle, material);
    this.pendingChanges.push({ kind: 'added', handle });
    return handle;
  }

  /** Read the material behind a handle. Returns `undefined` if removed. */
  get(handle: MaterialHandle<M>): M | undefined {
    return this.entries.get(handle);
  }

  /**
   * Apply `fn` to the material behind `handle` and queue a `Modified` event.
   * `fn` may mutate the material in place; the registry notifies the extract
   * system that the GPU bind group is stale.
   *
   * Returns `true` if the handle resolved and `fn` ran; `false` otherwise.
   */
  mutate(handle: MaterialHandle<M>, fn: (material: M) => void): boolean {
    const material = this.entries.get(handle);
    if (material === undefined) return false;
    fn(material);
    this.pendingChanges.push({ kind: 'modified', handle });
    return true;
  }

  /**
   * Drop the material behind `handle` and queue a `Removed` event.
   * Idempotent — removing an unknown / already-removed handle is a silent
   * no-op (no event emitted).
   */
  remove(handle: MaterialHandle<M>): void {
    if (!this.entries.delete(handle)) return;
    this.pendingChanges.push({ kind: 'removed', handle });
  }

  /** Whether `handle` resolves to a registered material. */
  has(handle: MaterialHandle<M>): boolean {
    return this.entries.has(handle);
  }

  /** Number of materials currently registered. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Drain the per-frame change buffer.
   *
   * Returns the queued events (in submission order) and resets the buffer.
   * Only the engine's extract system should call this — gameplay code that
   * needs to observe asset state should query directly.
   */
  drainPendingChanges(): MaterialAssetEvent<M>[] {
    const out = this.pendingChanges;
    this.pendingChanges = [];
    return out;
  }

  /** Enumerate every registered (handle, material) pair. Insertion order. */
  *iter(): IterableIterator<readonly [MaterialHandle<M>, M]> {
    for (const entry of this.entries) yield entry;
  }
}
