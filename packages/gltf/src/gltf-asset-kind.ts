import type { AssetKindDescriptor } from '@retro-engine/engine';

/** The asset-kind tag for a glTF / GLB document (its `.meta` and manifest `kind`). */
export const GLTF_ASSET_KIND = 'Gltf';

/**
 * Catalog descriptor for glTF / GLB assets. A loose `.glb` / `.gltf` a user drops
 * into a project is a source asset, so it is discoverable: it gets a sidecar
 * minted on discovery and shows in the asset browser under the `model` category.
 *
 * Exported as a shared constant so {@link GltfPlugin} registers it for any engine
 * host, and a tool that catalogs asset kinds without loading the full glTF runtime
 * (e.g. an asset browser) can register the same descriptor directly.
 */
export const gltfAssetKindDescriptor: AssetKindDescriptor = {
  kind: GLTF_ASSET_KIND,
  extensions: ['glb', 'gltf'],
  discoverable: true,
  largeBinary: true,
  category: 'model',
};
