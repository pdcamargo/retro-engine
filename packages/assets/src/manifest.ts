import type { AssetGuid } from './asset-id';

/** One project asset's persistent record: its stable id, where to read it, and what kind it is. */
export interface AssetManifestEntry {
  /** The asset's stable identity; references resolve through this, not the location. */
  readonly guid: AssetGuid;
  /** Where an {@link AssetSource} reads this asset's bytes from. Updated on rename; the GUID is not. */
  readonly location: string;
  /** The asset-kind tag selecting the importer / serializer for this asset. */
  readonly kind: string;
  /**
   * The asset's `.meta` sidecar fields baked into the manifest (import settings
   * like a texture's `filter` / `colorSpace`), so a bundle source can serve them
   * without shipping the loose sidecar. Omitted when the sidecar carries nothing
   * beyond `guid` / `kind`.
   */
  readonly meta?: Readonly<Record<string, unknown>>;
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

/** Current manifest wire-format version. Bumped only on a breaking shape change. */
export const MANIFEST_FORMAT_VERSION = 1;

/**
 * The on-the-wire JSON shape of a manifest: a format version and a flat list of
 * entries. {@link parseAssetManifest} folds this into an {@link AssetManifest},
 * keying the entries by GUID — JSON has no map type, so the wire form is a list.
 */
export interface AssetManifestFile {
  /** Wire-format version; must equal {@link MANIFEST_FORMAT_VERSION} to parse. */
  readonly version: number;
  /** Every project asset, in no particular order. */
  readonly entries: readonly AssetManifestEntry[];
}

/**
 * Parse a manifest's JSON text into an {@link AssetManifest}, keying its entries
 * by GUID. Throws if the JSON is malformed, the `version` does not equal
 * {@link MANIFEST_FORMAT_VERSION}, an entry lacks a string `guid` / `location` /
 * `kind`, or two entries share a GUID.
 */
export const parseAssetManifest = (text: string): AssetManifest => {
  const file = JSON.parse(text) as { version?: unknown; entries?: unknown };
  if (file.version !== MANIFEST_FORMAT_VERSION) {
    throw new Error(
      `parseAssetManifest: unsupported manifest version ${String(file.version)} (expected ${MANIFEST_FORMAT_VERSION}).`,
    );
  }
  if (!Array.isArray(file.entries)) {
    throw new Error('parseAssetManifest: manifest `entries` must be an array.');
  }
  const entries = new Map<AssetGuid, AssetManifestEntry>();
  for (const raw of file.entries as readonly unknown[]) {
    const entry = raw as { guid?: unknown; location?: unknown; kind?: unknown; meta?: unknown };
    if (
      typeof entry.guid !== 'string' ||
      typeof entry.location !== 'string' ||
      typeof entry.kind !== 'string'
    ) {
      throw new Error(
        'parseAssetManifest: every entry needs a string `guid`, `location`, and `kind`.',
      );
    }
    const guid = entry.guid as AssetGuid;
    if (entries.has(guid)) {
      throw new Error(`parseAssetManifest: duplicate GUID '${entry.guid}' in manifest.`);
    }
    const hasMeta = typeof entry.meta === 'object' && entry.meta !== null;
    entries.set(guid, {
      guid,
      location: entry.location,
      kind: entry.kind,
      ...(hasMeta ? { meta: entry.meta as Readonly<Record<string, unknown>> } : {}),
    });
  }
  return { entries };
};

/**
 * Fold a flat list of entries into an {@link AssetManifestFile} ready to write,
 * stamping the current {@link MANIFEST_FORMAT_VERSION}. The inverse of
 * {@link parseAssetManifest}'s GUID-keying: it rejects two entries sharing a
 * GUID, so `parseAssetManifest(serializeAssetManifest(bakeManifest(e)))`
 * reproduces the same entry map.
 */
export const bakeManifest = (entries: readonly AssetManifestEntry[]): AssetManifestFile => {
  const seen = new Set<AssetGuid>();
  for (const entry of entries) {
    if (seen.has(entry.guid)) {
      throw new Error(`bakeManifest: duplicate GUID '${entry.guid}'.`);
    }
    seen.add(entry.guid);
  }
  return { version: MANIFEST_FORMAT_VERSION, entries: [...entries] };
};

/**
 * Serialize an {@link AssetManifestFile} to the JSON text an {@link AssetSink}
 * writes and {@link parseAssetManifest} reads back. The inverse of
 * {@link parseAssetManifest}.
 */
export const serializeAssetManifest = (manifest: AssetManifestFile): string =>
  JSON.stringify(manifest, null, 2);
