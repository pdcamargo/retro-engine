import type {
  Assets,
  Handle,
  Image as ImageType,
  LoadContext,
  Mesh,
  StandardMaterial,
} from '@retro-engine/engine';

import type { ImageDecoder } from './image-decoder';
import { createImageResolver } from './image-mapping';
import { mapMaterialToStandardMaterial } from './material-mapping';
import { mapPrimitiveToMesh } from './mesh-mapping';
import type { GltfDocument } from './schema';

/** The engine asset stores a glTF load registers its sub-assets into. */
export interface GltfAssetStores {
  readonly meshes: Assets<Mesh>;
  readonly materials: Assets<StandardMaterial>;
  readonly images: Assets<ImageType>;
}

/** One mapped primitive: its engine mesh plus the material it draws with, if any. */
export interface MappedPrimitive {
  readonly mesh: Handle<Mesh>;
  readonly material?: Handle<StandardMaterial>;
}

/** A mapped glTF mesh — N primitives, each its own engine mesh + material. */
export interface MappedMesh {
  readonly primitives: readonly MappedPrimitive[];
}

/**
 * The engine assets a glTF document decodes into. `meshes` and `materials` are
 * indexed parallel to the document's `meshes` / `materials` arrays; `images`
 * lists every deduped image handle minted during the load.
 */
export interface MappedGltfAssets {
  readonly meshes: readonly MappedMesh[];
  readonly materials: readonly Handle<StandardMaterial>[];
  readonly images: readonly Handle<ImageType>[];
}

/**
 * Maps a decoded glTF document onto engine assets — meshes, materials, and
 * deduped images — registering each as a labeled sub-asset (`Mesh{i}/Primitive{j}`,
 * `Material{i}`, `Image{n}`) through {@link LoadContext.addLabeledAsset}.
 *
 * `buffers` are the already-resolved binary buffers (from `resolveBuffers`);
 * `decoder` turns image bytes into pixels. Materials are mapped before meshes and
 * in document order so image dedup is deterministic. The returned handles are the
 * input the glTF root asset wires into its scene/node graph.
 */
export const mapGltfAssets = async (
  document: GltfDocument,
  buffers: readonly Uint8Array[],
  ctx: LoadContext,
  stores: GltfAssetStores,
  decoder: ImageDecoder,
): Promise<MappedGltfAssets> => {
  const resolver = createImageResolver(document, buffers, ctx, stores.images, decoder);

  const materials: Handle<StandardMaterial>[] = [];
  const docMaterials = document.materials ?? [];
  for (let i = 0; i < docMaterials.length; i++) {
    const material = await mapMaterialToStandardMaterial(document, docMaterials[i]!, resolver);
    materials.push(ctx.addLabeledAsset(`Material${i}`, material, stores.materials));
  }

  const meshes: MappedMesh[] = [];
  const docMeshes = document.meshes ?? [];
  for (let i = 0; i < docMeshes.length; i++) {
    const primitives: MappedPrimitive[] = [];
    const prims = docMeshes[i]!.primitives;
    for (let j = 0; j < prims.length; j++) {
      const primitive = prims[j]!;
      const mesh = mapPrimitiveToMesh(document, buffers, primitive);
      const handle = ctx.addLabeledAsset(`Mesh${i}/Primitive${j}`, mesh, stores.meshes);
      const material = primitive.material !== undefined ? materials[primitive.material] : undefined;
      primitives.push(material !== undefined ? { mesh: handle, material } : { mesh: handle });
    }
    meshes.push({ primitives });
  }

  return { meshes, materials, images: resolver.handles };
};
