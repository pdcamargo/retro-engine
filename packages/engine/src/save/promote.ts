import type { AssetGuid, AssetManifestEntry, AssetSerializer, Handle } from '@retro-engine/assets';

import { bakeMeta, serializeMeta } from './meta';

/**
 * The persisted form of one promoted asset: its manifest entry plus the byte
 * payloads to write — the asset's own bytes and its `.meta` sidecar.
 */
export interface PromotedAsset {
  /** The manifest entry that resolves this asset's GUID to its location + kind. */
  readonly entry: AssetManifestEntry;
  /** Where the asset bytes are written (the entry's location). */
  readonly location: string;
  /** The serialized asset bytes. */
  readonly bytes: Uint8Array;
  /** Where the `.meta` sidecar is written (`<location>.meta`). */
  readonly metaLocation: string;
  /** The serialized `.meta` sidecar bytes. */
  readonly meta: Uint8Array;
}

/** Options controlling where a promoted asset's bytes land. */
export interface PromoteOptions {
  /**
   * File extension for the asset's location, without the dot. On reload,
   * `AssetServer.loadByGuid` dispatches the importer by this extension, so it
   * MUST match a registered importer (e.g. `'rmesh'` for the mesh importer).
   */
  readonly extension: string;
  /** Directory the asset is written under. Defaults to `'assets'`. */
  readonly dir?: string;
  /** Names the file (without extension) from the GUID. Defaults to the GUID itself. */
  readonly basename?: (guid: AssetGuid) => string;
}

const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Turn an in-memory asset into a project asset: serialize its bytes through the
 * `kind`'s serializer, assign a location keyed by the handle's persistent GUID,
 * and emit the manifest entry + `.meta` sidecar a save writes. The "CreateAsset
 * analogue" — every `Assets.add`'d asset already carries a GUID, so promotion
 * freezes that identity into the project rather than minting a new one.
 *
 * Throws if the handle has no GUID (a runtime-only asset has no persistent
 * identity to promote).
 */
export const promoteAsset = <T>(
  handle: Handle<T>,
  value: T,
  kind: string,
  serializer: AssetSerializer<T>,
  opts: PromoteOptions,
): PromotedAsset => {
  if (handle.guid === undefined) {
    throw new Error(
      'promoteAsset: handle has no GUID — a runtime-only asset has no persistent identity to promote.',
    );
  }
  const guid = handle.guid;
  const dir = opts.dir ?? 'assets';
  const base = (opts.basename ?? ((g) => g))(guid);
  const location = `${dir}/${base}.${opts.extension}`;
  const metaLocation = `${location}.meta`;
  return {
    entry: { guid, location, kind },
    location,
    bytes: serializer.serialize(value),
    metaLocation,
    meta: encodeText(serializeMeta(bakeMeta(guid))),
  };
};
