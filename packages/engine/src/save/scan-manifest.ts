import type { AssetGuid, AssetManifest, AssetManifestEntry } from '@retro-engine/assets';

const META_SUFFIX = '.meta';

/** One project file as a `[location, bytes]` pair — the shape an `AssetSink` writes. */
export type ProjectFile = readonly [location: string, bytes: Uint8Array];

/**
 * Rebuild the GUID→location index from a project's `.meta` sidecars — the
 * authoring counterpart to a committed manifest. Each `<asset>.meta` pins its
 * asset's GUID and kind (see `bakeMeta`); the asset's location is the sidecar
 * path with `.meta` stripped. The result satisfies the same {@link AssetManifest}
 * contract `AssetServer.setManifest` consumes, so a scanned project loads through
 * the existing read path with no committed manifest on disk.
 *
 * @param files Every project file as `[location, bytes]`; non-`.meta` files are ignored.
 * @throws if a sidecar is malformed or two sidecars pin the same GUID.
 */
export const scanMetaManifest = (files: Iterable<ProjectFile>): AssetManifest => {
  const decoder = new TextDecoder();
  const entries = new Map<AssetGuid, AssetManifestEntry>();

  for (const [location, bytes] of files) {
    if (!location.endsWith(META_SUFFIX)) continue;
    const raw: unknown = JSON.parse(decoder.decode(bytes));
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`scanMetaManifest: '${location}' is not a JSON object`);
    }
    const meta = raw as { guid?: unknown; kind?: unknown };
    if (typeof meta.guid !== 'string' || typeof meta.kind !== 'string') {
      throw new Error(`scanMetaManifest: '${location}' is missing a string 'guid' or 'kind'`);
    }
    const assetLocation = location.slice(0, -META_SUFFIX.length);
    const guid = meta.guid as AssetGuid;
    if (entries.has(guid)) {
      throw new Error(`scanMetaManifest: duplicate GUID '${guid}' across sidecars`);
    }
    entries.set(guid, { guid, location: assetLocation, kind: meta.kind });
  }

  return { entries };
};
