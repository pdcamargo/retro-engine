import type { Handle } from './handle';

/**
 * A lifecycle change buffered by an {@link Assets} store for a schedule-bound
 * system to drain once per frame.
 *
 * - `added` — a value was inserted under a fresh or reserved slot.
 * - `modified` — the value behind a handle changed (`getMut` or an overwriting
 *   `insert`); its GPU representation is stale and must be re-prepared.
 * - `removed` — the value behind a handle was dropped.
 * - `unused` — the last conceptual reference to an asset went away. Emitted for
 *   editor diagnostics only; nothing frees on it, since a handle never owns its
 *   asset.
 */
export type AssetEvent<T> =
  | { readonly kind: 'added'; readonly handle: Handle<T> }
  | { readonly kind: 'modified'; readonly handle: Handle<T> }
  | { readonly kind: 'removed'; readonly handle: Handle<T> }
  | { readonly kind: 'unused'; readonly handle: Handle<T> };
