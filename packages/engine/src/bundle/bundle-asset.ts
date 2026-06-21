import type { AssetSerializer } from '@retro-engine/assets';
import type { SerializedValue } from '@retro-engine/reflect';

import type { BundleDefinition } from './bundle-definition';

/** The asset-kind tag for a bundle asset — its `.meta` `kind` and serializer key. */
export const BUNDLE_ASSET_KIND = 'Bundle';

/** File extension for a bundle asset, without the leading dot. */
export const BUNDLE_ASSET_EXTENSION = 'rebundle';

/** On-disk format version for a `.rebundle` bundle asset. */
export const BUNDLE_FORMAT_VERSION = 1;

/**
 * A `.rebundle` file: a format version wrapping a bundle's name and its
 * components. A bundle stores its components already serialized (each a
 * `{ type, version, data }`), so this file is the on-disk mirror of an
 * in-memory {@link BundleDefinition} — no per-component encode/decode is needed
 * to read or write it.
 */
interface BundleFile {
  readonly formatVersion: number;
  readonly name: string;
  readonly components: readonly SerializedValue[];
}

/** Encode a {@link BundleDefinition} to the bytes of a `.rebundle` file. */
export const serializeBundle = (def: BundleDefinition): Uint8Array => {
  const file: BundleFile = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    name: def.name,
    components: def.components,
  };
  return new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`);
};

/**
 * Decode the bytes of a `.rebundle` file into a {@link BundleDefinition}.
 * `fallbackName` names the bundle when the file omits one (e.g. derived from
 * the asset's location); the file's own `name` wins when present.
 */
export const deserializeBundle = (bytes: Uint8Array, fallbackName = 'Bundle'): BundleDefinition => {
  const file = JSON.parse(new TextDecoder().decode(bytes)) as Partial<BundleFile>;
  const components = Array.isArray(file.components) ? file.components : [];
  return {
    name: typeof file.name === 'string' && file.name.length > 0 ? file.name : fallbackName,
    components,
  };
};

/**
 * Round-trip serializer for a `.rebundle` asset, registered under
 * {@link BUNDLE_ASSET_KIND} so the project-save layer can write a bundle back
 * after an edit and re-read it on load.
 */
export const createBundleSerializer = (): AssetSerializer<BundleDefinition> => ({
  serialize: serializeBundle,
  deserialize: (bytes) => deserializeBundle(bytes),
});
