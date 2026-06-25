import type { AssetImporter } from '@retro-engine/engine';

import type { GltfAssetStores } from './asset-mapping';
import { mapGltfAssets } from './asset-mapping';
import { buildGltfRoot } from './build-gltf-root';
import { resolveBuffers } from './buffers';
import type { Gltf } from './gltf-root';
import type { ImageDecoder } from './image-decoder';
import { parseGltf } from './parse';

/**
 * Build the {@link AssetImporter} that turns `.gltf` / `.glb` bytes into a
 * {@link Gltf} root asset. It parses the container (validating version and the
 * required-extension contract), resolves external/embedded buffers through the
 * load context, maps primitives/materials/images into the given engine stores
 * as labeled sub-assets, and assembles the root.
 *
 * `stores` are the engine stores sub-assets register into (captured by the
 * owning plugin); `decoder` turns image bytes into pixels. A parse or mapping
 * failure rejects the importer's promise, so the load commits no partial graph.
 */
export const createGltfImporter =
  (stores: GltfAssetStores, decoder: ImageDecoder): AssetImporter<Gltf> =>
  async (bytes, ctx) => {
    const { document, bin } = parseGltf(bytes);
    const buffers = await resolveBuffers(document, bin, ctx.read);
    const mapped = await mapGltfAssets(document, buffers, ctx, stores, decoder);
    return buildGltfRoot(document, mapped, buffers);
  };
