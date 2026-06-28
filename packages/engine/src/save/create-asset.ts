import type { AssetGuid, AssetSerializer, AssetSink } from '@retro-engine/assets';
import { asAssetIndex, generateAssetGuid, makeHandle } from '@retro-engine/assets';

import { promoteAsset, type PromoteOptions } from './promote';

/** A brand-new project asset: its minted GUID, the file it was written to, and the bytes written. */
export interface CreatedAsset {
  /** The freshly minted GUID — load the asset back with `AssetServer.loadByGuid`. */
  readonly guid: AssetGuid;
  /** The project-relative path the asset bytes were written to. */
  readonly location: string;
  /** The serialized asset bytes (the same payload written to {@link location}). */
  readonly bytes: Uint8Array;
}

/**
 * Mint a brand-new project asset from an in-memory value: generate a fresh GUID,
 * serialize the value through its `kind` serializer, and write both the asset
 * file and its `.meta` sidecar through `sink`.
 *
 * The complement to {@link promoteAsset} for values that don't yet have a handle
 * — it owns only the serialize-and-write half. Making the new asset resolvable by
 * GUID at runtime (rebuilding the manifest, filling the live store slot) is the
 * caller's responsibility, since that depends on the live `AssetServer`.
 *
 * @param value the in-memory asset value to persist
 * @param kind the asset kind tag its serializer + `.meta` are registered under
 * @param serializer the serializer for `kind`
 * @param sink where the asset + sidecar bytes are written
 * @param opts location options (extension, directory) — see {@link PromoteOptions}
 */
export const createAsset = async <T>(
  value: T,
  kind: string,
  serializer: AssetSerializer<T>,
  sink: AssetSink,
  opts: PromoteOptions,
): Promise<CreatedAsset> => {
  const guid = generateAssetGuid();
  const promoted = promoteAsset(makeHandle(asAssetIndex(0), guid), value, kind, serializer, opts);
  await sink.write(promoted.location, promoted.bytes);
  await sink.write(promoted.metaLocation, promoted.meta);
  return { guid, location: promoted.location, bytes: promoted.bytes };
};
