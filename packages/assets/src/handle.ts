import type { AssetGuid, AssetIndex } from './asset-id';

/**
 * A cheap value reference to an asset in an {@link Assets} store.
 *
 * A handle wraps an {@link AssetIndex} (the hot-path lookup key), an optional
 * {@link AssetGuid} (present only for project-backed assets), and a phantom `T`
 * so a `Handle<Mesh>` is not assignable to a `Handle<Image>`. The phantom has
 * no runtime representation — a handle is just `{ index }`, optionally with
 * `guid`.
 *
 * Handles keep nothing alive and nothing auto-frees: a handle both resolves and
 * never owns. An asset's lifetime is owned by its store and is released
 * explicitly (`assets.remove`) or in bulk by scene teardown. Compare handles
 * with {@link handleEq} — equality is by index.
 */
export interface Handle<T> {
  /** The store slot this handle resolves through. The draw hot path reads this. */
  readonly index: AssetIndex;
  /** The persistent identity, present only for project-backed assets. */
  readonly guid?: AssetGuid;
  /** Phantom marker carrying the asset type. Never present at runtime. */
  readonly __type?: T;
}

/** Build a {@link Handle} for `index`, optionally carrying a persistent `guid`. */
export const makeHandle = <T>(index: AssetIndex, guid?: AssetGuid): Handle<T> =>
  guid === undefined ? { index } : { index, guid };

/** Whether two handles point at the same store slot. Equality is by index. */
export const handleEq = <T>(a: Handle<T>, b: Handle<T>): boolean => a.index === b.index;
