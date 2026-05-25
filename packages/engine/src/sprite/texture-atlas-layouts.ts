import type { TextureAtlasLayout } from './texture-atlas-layout';

/**
 * Opaque handle into the {@link TextureAtlasLayouts} registry.
 *
 * Branded `number` so plain ids cannot accidentally substitute. Compare with
 * `===`. Stable for the lifetime of the layout in the registry — `remove`
 * invalidates the handle and reuses the slot for a new add.
 *
 * Pre-asset-system shape: when `@retro-engine/assets` lands,
 * `TextureAtlasLayoutHandle` folds into the asset system's
 * `Handle<TextureAtlasLayout>`. The branded numeric id is the shape Bevy uses
 * internally for `AssetId<TextureAtlasLayout>`; the upgrade path is
 * structural.
 */
export type TextureAtlasLayoutHandle = number & {
  readonly __atlasLayoutHandle: unique symbol;
};

const asLayoutHandle = (id: number): TextureAtlasLayoutHandle =>
  id as TextureAtlasLayoutHandle;

/**
 * Per-frame change buffered by {@link TextureAtlasLayouts} for downstream
 * consumers. Mirrors {@link ImageAssetEvent} and Bevy's
 * `AssetEvent::{Added, Modified, Removed}` semantics.
 */
export type TextureAtlasLayoutAssetEvent =
  | { readonly kind: 'added'; readonly handle: TextureAtlasLayoutHandle }
  | { readonly kind: 'modified'; readonly handle: TextureAtlasLayoutHandle }
  | { readonly kind: 'removed'; readonly handle: TextureAtlasLayoutHandle };

/**
 * App-level registry mapping {@link TextureAtlasLayoutHandle}s to
 * {@link TextureAtlasLayout} instances.
 *
 * Inserted as a main-world resource by `SpritePlugin`. Gameplay / spawn-time
 * code calls `layouts.add(layout)` to register a layout and gets back a
 * handle; {@link TextureAtlas} components on entities hold the handle.
 *
 * Internally the registry buffers a per-frame list of lifecycle events
 * (`Added` / `Modified` / `Removed`); the buffer is drained once per frame
 * for downstream extract systems. Layouts are typically immutable — `replace`
 * is provided for hot-reload and tooling use cases.
 *
 * Pre-asset-system shape: when the asset system lands, `TextureAtlasLayouts`
 * folds into `AssetServer<TextureAtlasLayout>` and the
 * {@link TextureAtlasLayoutAssetEvent} queue becomes the standard Bevy
 * `AssetEvent<TextureAtlasLayout>` channel. Consumer-facing API ergonomics
 * are preserved across the migration: `add` / `get` / `replace` / `remove`
 * map cleanly to the asset-system equivalents.
 */
export class TextureAtlasLayouts {
  private readonly entries = new Map<TextureAtlasLayoutHandle, TextureAtlasLayout>();
  private nextId = 1;
  private pendingChanges: TextureAtlasLayoutAssetEvent[] = [];

  /**
   * Register `layout` under a fresh handle and queue an `Added` event for the
   * next extract pass. Returns the handle; {@link TextureAtlas} components
   * store it.
   */
  add(layout: TextureAtlasLayout): TextureAtlasLayoutHandle {
    const handle = asLayoutHandle(this.nextId++);
    this.entries.set(handle, layout);
    this.pendingChanges.push({ kind: 'added', handle });
    return handle;
  }

  /** Read the layout behind a handle. Returns `undefined` if the handle was removed. */
  get(handle: TextureAtlasLayoutHandle): TextureAtlasLayout | undefined {
    return this.entries.get(handle);
  }

  /**
   * Replace the layout behind `handle` with a fresh value and queue a
   * `Modified` event. Layouts are otherwise immutable, so mutation is by
   * replacement rather than in-place edit.
   *
   * Returns `true` if the handle resolved; `false` (no event emitted) if the
   * handle was unknown.
   */
  replace(handle: TextureAtlasLayoutHandle, layout: TextureAtlasLayout): boolean {
    if (!this.entries.has(handle)) return false;
    this.entries.set(handle, layout);
    this.pendingChanges.push({ kind: 'modified', handle });
    return true;
  }

  /**
   * Drop the layout behind `handle` and queue a `Removed` event. Idempotent —
   * removing an unknown / already-removed handle is a silent no-op (no event
   * emitted).
   */
  remove(handle: TextureAtlasLayoutHandle): void {
    if (!this.entries.delete(handle)) return;
    this.pendingChanges.push({ kind: 'removed', handle });
  }

  /** Whether `handle` resolves to a registered layout. */
  has(handle: TextureAtlasLayoutHandle): boolean {
    return this.entries.has(handle);
  }

  /** Number of layouts currently registered. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Drain the per-frame change buffer. Returns the queued events (in
   * submission order) and resets the buffer. Subsequent calls inside the same
   * frame return an empty array.
   */
  drainPendingChanges(): TextureAtlasLayoutAssetEvent[] {
    const out = this.pendingChanges;
    this.pendingChanges = [];
    return out;
  }

  /** Enumerate every registered (handle, layout) pair. Insertion order. */
  *iter(): IterableIterator<readonly [TextureAtlasLayoutHandle, TextureAtlasLayout]> {
    for (const entry of this.entries) yield entry;
  }
}
