import type { AssetGuid } from '@retro-engine/assets';

/** Current `.meta` sidecar wire-format version. */
export const META_FORMAT_VERSION = 1;

/**
 * The sidecar written next to a persisted asset, pinning its stable
 * {@link AssetGuid} to the file. Lets a future tool rename the asset file and
 * rebuild the manifest from sidecars without breaking GUID references.
 *
 * The load path resolves GUIDs through the manifest, not these sidecars, so a
 * `.meta` is forward-compat scaffolding — written on save, not required to load.
 * Richer import settings join this shape when the studio needs them.
 */
export interface AssetMetaFile {
  readonly version: number;
  readonly guid: AssetGuid;
}

/** Build the `.meta` record for `guid`. */
export const bakeMeta = (guid: AssetGuid): AssetMetaFile => ({ version: META_FORMAT_VERSION, guid });

/** Serialize an {@link AssetMetaFile} to its JSON text. */
export const serializeMeta = (meta: AssetMetaFile): string => JSON.stringify(meta, null, 2);
