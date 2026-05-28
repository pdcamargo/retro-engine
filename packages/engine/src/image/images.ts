import { vec4 } from '@retro-engine/math';

import { Image } from './image';

/**
 * Opaque handle into the {@link Images} registry.
 *
 * Branded `number` so plain ids cannot accidentally substitute. Compare with
 * `===`. Stable for the lifetime of the image in the registry — `remove`
 * invalidates the handle and reuses the slot for a new add.
 *
 * Pre-asset-system shape: when `@retro-engine/assets` lands, `ImageHandle`
 * folds into the asset system's `Handle<Image>`. The branded numeric id is the
 * shape Bevy uses internally for `AssetId<Image>`; the upgrade path is
 * structural.
 */
export type ImageHandle = number & { readonly __imageHandle: unique symbol };

const asImageHandle = (id: number): ImageHandle => id as ImageHandle;

/**
 * Per-frame change buffered by {@link Images} for `ImagePlugin`'s extract
 * system to drain. Mirrors Bevy's `AssetEvent::{Added, Modified, Removed}`
 * semantics one-for-one with `MeshAssetEvent`.
 */
export type ImageAssetEvent =
  | { readonly kind: 'added'; readonly handle: ImageHandle }
  | { readonly kind: 'modified'; readonly handle: ImageHandle }
  | { readonly kind: 'removed'; readonly handle: ImageHandle };

/**
 * App-level registry mapping {@link ImageHandle}s to {@link Image} instances.
 *
 * Inserted as a main-world resource by `ImagePlugin`. Gameplay / spawn-time
 * code calls `images.add(image)` to register an image and gets back a handle;
 * materials and other components hold the handle.
 *
 * Three well-known defaults are seeded by the constructor and exposed as
 * readonly handles: {@link Images.WHITE} (opaque white), {@link Images.BLACK}
 * (opaque black), and {@link Images.NORMAL_FLAT} (a flat normal map,
 * `(0.5, 0.5, 1, 1)`). Bind-group schemas declare a `fallback` (`'white' |
 * 'black' | 'normalFlat'`) so a material referencing an `undefined` image
 * field resolves to the matching default at prepare time.
 *
 * Internally the registry buffers a per-frame list of lifecycle events
 * (`Added` / `Modified` / `Removed`); the plugin's extract system drains the
 * buffer once per frame and forwards events to the prepare system. Gameplay
 * code does not read from this buffer.
 *
 * Pre-asset-system shape: when the asset system lands, `Images` folds into
 * `AssetServer<Image>` and the `ImageAssetEvent` queue becomes the standard
 * Bevy `AssetEvent<Image>` channel. Consumer-facing API ergonomics are
 * preserved across the migration: `add` / `get` / `mutate` / `remove` map
 * cleanly to the asset-system equivalents.
 */
export class Images {
  private readonly entries = new Map<ImageHandle, Image>();
  private nextId = 1;
  private pendingChanges: ImageAssetEvent[] = [];

  /** 1×1 opaque white. Default fallback for colour / metallic-roughness / emissive / occlusion textures. */
  readonly WHITE: ImageHandle;
  /** 1×1 opaque black. */
  readonly BLACK: ImageHandle;
  /** 1×1 flat normal map `(0.5, 0.5, 1, 1)` — encodes a straight-up tangent-space normal. Default fallback for normal-map textures. */
  readonly NORMAL_FLAT: ImageHandle;

  constructor() {
    // WHITE / BLACK default to colorSpace 'srgb' (the StandardMaterial fallback
    // is used for both color slots — baseColor, emissive — and data slots —
    // metallic-roughness, occlusion). The 0.0 and 1.0 components are invariant
    // under sRGB ↔ linear decode, so an 'srgb' fallback samples correctly
    // through either path.
    this.WHITE = this.add(Image.solid(vec4.create(1, 1, 1, 1), { label: 'image#WHITE' }));
    this.BLACK = this.add(Image.solid(vec4.create(0, 0, 0, 1), { label: 'image#BLACK' }));
    // NORMAL_FLAT must be linear: a `(0.5, 0.5, 1, 1)` literal sRGB-decodes to
    // ~`(0.214, 0.214, 1, 1)` linear, which would corrupt tangent-space normal
    // sampling.
    this.NORMAL_FLAT = this.add(
      Image.solid(vec4.create(0.5, 0.5, 1, 1), {
        label: 'image#NORMAL_FLAT',
        colorSpace: 'linear',
      }),
    );
  }

  /**
   * Register `image` under a fresh handle and queue an `Added` event for the
   * next extract pass. Returns the handle; downstream components store it.
   */
  add(image: Image): ImageHandle {
    const handle = asImageHandle(this.nextId++);
    this.entries.set(handle, image);
    this.pendingChanges.push({ kind: 'added', handle });
    return handle;
  }

  /** Read the image behind a handle. Returns `undefined` if the handle was removed. */
  get(handle: ImageHandle): Image | undefined {
    return this.entries.get(handle);
  }

  /**
   * Replace the image behind `handle` with a fresh value and queue a
   * `Modified` event. `Image` itself is immutable, so mutation is by
   * replacement rather than in-place edit.
   *
   * Returns `true` if the handle resolved; `false` (no event emitted) if the
   * handle was unknown.
   */
  replace(handle: ImageHandle, image: Image): boolean {
    if (!this.entries.has(handle)) return false;
    this.entries.set(handle, image);
    this.pendingChanges.push({ kind: 'modified', handle });
    return true;
  }

  /**
   * Drop the image behind `handle` and queue a `Removed` event. Idempotent —
   * removing an unknown / already-removed handle is a silent no-op (no event
   * emitted).
   */
  remove(handle: ImageHandle): void {
    if (!this.entries.delete(handle)) return;
    this.pendingChanges.push({ kind: 'removed', handle });
  }

  /** Whether `handle` resolves to a registered image. */
  has(handle: ImageHandle): boolean {
    return this.entries.has(handle);
  }

  /** Number of images currently registered. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Drain the per-frame change buffer. Returns the queued events (in
   * submission order) and resets the buffer. Only the engine's extract system
   * should call this; subsequent calls inside the same frame return an empty
   * array.
   */
  drainPendingChanges(): ImageAssetEvent[] {
    const out = this.pendingChanges;
    this.pendingChanges = [];
    return out;
  }

  /** Enumerate every registered (handle, image) pair. Insertion order. */
  *iter(): IterableIterator<readonly [ImageHandle, Image]> {
    for (const entry of this.entries) yield entry;
  }
}
