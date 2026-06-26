/**
 * A dense runtime slot assigned by an {@link Assets} store on insert.
 *
 * Branded `number` so a plain integer cannot accidentally substitute. This is
 * the hot-path lookup key: render caches and stores key on it directly. The
 * store mints indices monotonically with no reuse, so an index is stable for
 * the lifetime of the process and never aliases a different asset.
 */
export type AssetIndex = number & { readonly __assetIndex: unique symbol };

/**
 * A random v4 UUID that is an asset's persistent identity and serialization
 * key. Stable across edits, moves, and renames; references between assets are
 * stored by GUID, never by path or by runtime index. Never appears on the draw
 * hot path — that is what {@link AssetIndex} is for.
 */
export type AssetGuid = string & { readonly __assetGuid: unique symbol };

/**
 * The logical identity of an asset.
 *
 * `runtime` is a code-created asset that exists only for this session — it has
 * an index but no persistent identity. `guid` is a project-backed asset that
 * also carries its stable {@link AssetGuid}; it is still assigned an index when
 * loaded, so at runtime *everything* resolves through an index and the GUID is
 * metadata for persistence.
 *
 * The phantom `T` keeps an id for one asset type from being mistaken for
 * another; it has no runtime representation.
 */
export type AssetId<T> =
  | { readonly kind: 'runtime'; readonly index: AssetIndex; readonly __type?: T }
  | {
      readonly kind: 'guid';
      readonly index: AssetIndex;
      readonly guid: AssetGuid;
      readonly __type?: T;
    };

/** Brand a plain `number` as an {@link AssetIndex}. Used by stores when minting slots. */
export const asAssetIndex = (value: number): AssetIndex => value as AssetIndex;

/**
 * Mint a fresh random v4 {@link AssetGuid}. Used when a code-created asset is
 * promoted to a project asset, or when a new project asset is imported.
 */
export const generateAssetGuid = (): AssetGuid => crypto.randomUUID() as AssetGuid;

/**
 * Separator between a container asset's GUID and a sub-asset label in a
 * sub-asset reference. A v4 UUID never contains `#`, so the first `#` cleanly
 * splits a reference into parent GUID and label.
 */
const SUB_ASSET_SEPARATOR = '#';

/**
 * The persistent identity of a sub-asset extracted from a container file — an
 * animation clip, mesh, or material decoded out of a model, for example.
 *
 * Sub-assets have no `.meta` sidecar of their own, so they cannot carry a random
 * GUID. Instead their identity is derived deterministically from the container's
 * GUID and the importer's stable label (`'Animation0'`, `'Mesh0/Primitive1'`),
 * joined as `"<parent>#<label>"`. The result is a single string, so it
 * serializes and resolves exactly like a top-level GUID — a saved reference to a
 * model's clip survives reload as long as the container and its labels are stable.
 */
export const subAssetGuid = (parent: AssetGuid, label: string): AssetGuid =>
  `${parent}${SUB_ASSET_SEPARATOR}${label}` as AssetGuid;

/**
 * Split a {@link subAssetGuid} back into its container GUID and label, or
 * `undefined` when `guid` is a plain top-level GUID (no separator). This is the
 * single place the `"<parent>#<label>"` convention is decoded.
 */
export const parseSubAssetGuid = (
  guid: AssetGuid,
): { readonly parent: AssetGuid; readonly label: string } | undefined => {
  const hash = guid.indexOf(SUB_ASSET_SEPARATOR);
  if (hash <= 0 || hash === guid.length - 1) return undefined;
  return {
    parent: guid.slice(0, hash) as AssetGuid,
    label: guid.slice(hash + 1),
  };
};

/**
 * The store key for an {@link AssetId}, regardless of kind. Both a runtime and
 * a GUID-backed id resolve through their {@link AssetIndex}.
 */
export const assetIndexOf = <T>(id: AssetId<T>): AssetIndex => id.index;
