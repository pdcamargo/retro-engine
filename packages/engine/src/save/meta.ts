import type { AssetGuid } from '@retro-engine/assets';

/** Current `.meta` sidecar wire-format version. */
export const META_FORMAT_VERSION = 1;

/**
 * Per-kind metadata carried in a sidecar's optional `data` field — import
 * settings and authored sub-asset definitions specific to one asset kind (for
 * example a texture's sprite rect map). The shape is owned by the asset kind, not
 * this module: each kind reads and writes the subset it understands.
 */
export type AssetMetaData = Record<string, unknown>;

/**
 * The sidecar written next to a persisted asset, pinning its stable
 * {@link AssetGuid} (and asset `kind`) to the file. It is the **source of truth**
 * for asset identity: the project ships `.meta` sidecars, not a committed
 * manifest, and the GUID→location index is rebuilt by scanning them
 * (`scanMetaManifest`). Pinning identity to the file lets an asset move or rename
 * without breaking GUID references.
 */
export interface AssetMetaFile {
  readonly version: number;
  readonly guid: AssetGuid;
  /** The asset-kind tag (the manifest `kind`; keys the importer + store on reload). */
  readonly kind: string;
  /**
   * Optional per-kind import settings and authored sub-asset data. Absent on a
   * sidecar that carries only identity, so reading it must tolerate `undefined`.
   * Its shape is defined by the asset `kind` — see {@link AssetMetaData}.
   */
  readonly data?: AssetMetaData;
}

/** Build the `.meta` record pinning `guid` and its asset `kind`. */
export const bakeMeta = (guid: AssetGuid, kind: string): AssetMetaFile => ({
  version: META_FORMAT_VERSION,
  guid,
  kind,
});

/** Build a `.meta` record pinning `guid` + `kind` and carrying a per-kind `data` body. */
export const bakeMetaWithData = (
  guid: AssetGuid,
  kind: string,
  data: AssetMetaData,
): AssetMetaFile => ({
  version: META_FORMAT_VERSION,
  guid,
  kind,
  data,
});

/** Serialize an {@link AssetMetaFile} to its JSON text. */
export const serializeMeta = (meta: AssetMetaFile): string => JSON.stringify(meta, null, 2);

/**
 * Parse a sidecar's JSON text into an {@link AssetMetaFile}.
 *
 * @throws if the text is not a JSON object or is missing a string `guid`/`kind`.
 */
export const parseMeta = (text: string): AssetMetaFile => {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('parseMeta: sidecar is not a JSON object');
  }
  const meta = raw as { version?: unknown; guid?: unknown; kind?: unknown; data?: unknown };
  if (typeof meta.guid !== 'string' || typeof meta.kind !== 'string') {
    throw new Error("parseMeta: sidecar is missing a string 'guid' or 'kind'");
  }
  const version = typeof meta.version === 'number' ? meta.version : META_FORMAT_VERSION;
  const base: AssetMetaFile = { version, guid: meta.guid as AssetGuid, kind: meta.kind };
  if (typeof meta.data === 'object' && meta.data !== null) {
    return { ...base, data: meta.data as AssetMetaData };
  }
  return base;
};
