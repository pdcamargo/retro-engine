/**
 * A persistent key/value store for small pieces of editor state — window
 * layout, last selection, simple toggles.
 *
 * Values are opaque strings; structured data is the caller's responsibility to
 * encode (e.g. JSON). The store is intended for small, machine-managed state,
 * not for large documents or human-edited settings files.
 *
 * Every method is asynchronous so one interface can sit over both a synchronous
 * web backend (`localStorage`) and an asynchronous native one (inter-process
 * calls to a desktop shell).
 */
export interface PreferenceStore {
  /** Read a value, or `null` if the key has never been set. */
  get(key: string): Promise<string | null>;
  /** Write a value, overwriting any existing one for the key. */
  set(key: string, value: string): Promise<void>;
  /** Delete a key. A no-op if the key does not exist. */
  remove(key: string): Promise<void>;
}
