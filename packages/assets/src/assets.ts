import { asAssetIndex, type AssetIndex } from './asset-id';
import type { AssetEvent } from './events';
import { makeHandle, type Handle } from './handle';

/**
 * The owning store for one asset type `T`, mapping {@link AssetIndex} to value.
 *
 * `add` mints a fresh runtime slot and returns a {@link Handle}; downstream
 * components hold the handle, not the value. Mutating access (`getMut`,
 * `remove`, an overwriting `insert`) buffers an {@link AssetEvent} that a
 * schedule-bound system drains once per frame via {@link drainEvents} to keep
 * the GPU representation in sync. Indices are minted monotonically with no
 * reuse, so a handle never silently resolves to a different asset.
 *
 * The store owns asset lifetime: a handle keeps nothing alive, and removal is
 * always explicit. This generalizes the per-type registries the engine grew for
 * meshes, images, materials, and atlas layouts into one shape.
 */
export class Assets<T> {
  private readonly entries = new Map<AssetIndex, T>();
  private nextIndex = 1;
  private events: AssetEvent<T>[] = [];

  /**
   * Register `value` under a fresh runtime slot and queue an `added` event.
   * Returns the handle; the asset has no persistent GUID until it is promoted.
   */
  add(value: T): Handle<T> {
    const index = asAssetIndex(this.nextIndex++);
    this.entries.set(index, value);
    const handle = makeHandle<T>(index);
    this.events.push({ kind: 'added', handle });
    return handle;
  }

  /** Read the value behind `handle`, or `undefined` if the slot is empty or removed. */
  get(handle: Handle<T>): T | undefined {
    return this.entries.get(handle.index);
  }

  /**
   * Return the value behind `handle` for in-place mutation and queue a single
   * `modified` event. Returns `undefined` (and queues nothing) if the handle
   * does not resolve. The caller mutates the returned value directly; the event
   * signals that its GPU representation is now stale.
   */
  getMut(handle: Handle<T>): T | undefined {
    const value = this.entries.get(handle.index);
    if (value === undefined) return undefined;
    this.events.push({ kind: 'modified', handle });
    return value;
  }

  /**
   * Place `value` at `handle`'s slot, queuing `added` if the slot was empty
   * (e.g. filling a slot from {@link reserveHandle} once an async load
   * completes) or `modified` if it overwrote an existing value.
   */
  insert(handle: Handle<T>, value: T): void {
    const kind = this.entries.has(handle.index) ? 'modified' : 'added';
    this.entries.set(handle.index, value);
    this.events.push({ kind, handle });
  }

  /**
   * Drop the value behind `handle` and queue a `removed` event. Idempotent —
   * removing an unknown or already-removed handle is a silent no-op.
   */
  remove(handle: Handle<T>): void {
    if (!this.entries.delete(handle.index)) return;
    this.events.push({ kind: 'removed', handle });
  }

  /**
   * Mint a fresh slot with no value yet and return its handle, queuing no
   * event. Used by async loading: a consumer gets a stable handle immediately
   * and `get` returns `undefined` until {@link insert} fills the slot. The
   * handle is valid for the lifetime of the store.
   */
  reserveHandle(): Handle<T> {
    return makeHandle<T>(asAssetIndex(this.nextIndex++));
  }

  /** Whether `handle` resolves to a stored value. */
  has(handle: Handle<T>): boolean {
    return this.entries.has(handle.index);
  }

  /** Number of stored values. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Drain the buffered lifecycle events in submission order and reset the
   * buffer. Only a schedule-bound system should call this; a subsequent call in
   * the same frame returns an empty array.
   */
  drainEvents(): AssetEvent<T>[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Enumerate every stored `(index, value)` pair in insertion order. */
  *iter(): IterableIterator<readonly [AssetIndex, T]> {
    yield* this.entries;
  }
}
