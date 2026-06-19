import type { AssetGuid } from '@retro-engine/assets';

/** Current `.meta` sidecar wire-format version. */
export const META_FORMAT_VERSION = 1;

/**
 * The sidecar written next to a persisted asset, pinning its stable
 * {@link AssetGuid} (and asset `kind`) to the file. It is the **source of truth**
 * for asset identity: the project ships `.meta` sidecars, not a committed
 * manifest, and the GUID→location index is rebuilt by scanning them
 * (`scanMetaManifest`). Pinning identity to the file lets an asset move or rename
 * without breaking GUID references. Richer import settings join this shape when
 * the studio needs them.
 */
export interface AssetMetaFile {
  readonly version: number;
  readonly guid: AssetGuid;
  /** The asset-kind tag (the manifest `kind`; keys the importer + store on reload). */
  readonly kind: string;
}

/** Build the `.meta` record pinning `guid` and its asset `kind`. */
export const bakeMeta = (guid: AssetGuid, kind: string): AssetMetaFile => ({
  version: META_FORMAT_VERSION,
  guid,
  kind,
});

/** Serialize an {@link AssetMetaFile} to its JSON text. */
export const serializeMeta = (meta: AssetMetaFile): string => JSON.stringify(meta, null, 2);
