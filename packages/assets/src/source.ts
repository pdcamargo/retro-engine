/**
 * Reads asset bytes from some backing store, resolving a location to its raw
 * content. The location is abstract: a disk source maps it to a loose file, a
 * bundle source to a pre-baked entry. One asset server is given one source at
 * startup — the renderer-backend dependency-injection pattern applied to
 * assets, so the studio (disk, live importers) and the web build (bundle,
 * pre-baked) share the same loading path.
 */
export interface AssetSource {
  /** Read the raw bytes at `location`, rejecting if it cannot be resolved. */
  read(location: string): Promise<Uint8Array>;
}
