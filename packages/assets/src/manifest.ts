import type { AssetGuid } from './asset-id';

/** One project asset's persistent record: its stable id, where to read it, and what kind it is. */
export interface AssetManifestEntry {
  /** The asset's stable identity; references resolve through this, not the location. */
  readonly guid: AssetGuid;
  /** Where an {@link AssetSource} reads this asset's bytes from. Updated on rename; the GUID is not. */
  readonly location: string;
  /** The asset-kind tag selecting the importer / serializer for this asset. */
  readonly kind: string;
}

/**
 * The GUID→location index for a set of project assets. A disk source builds it
 * from `.meta` sidecars; a bundle source reads it pre-baked. Resolving a GUID
 * yields its {@link AssetManifestEntry}, so references survive moves and renames
 * that only change an entry's `location`.
 */
export interface AssetManifest {
  /** Every project asset keyed by its stable {@link AssetGuid}. */
  readonly entries: ReadonlyMap<AssetGuid, AssetManifestEntry>;
}
