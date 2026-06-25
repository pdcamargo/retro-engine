export { GltfImportError } from './gltf-error';
export type { GltfErrorCode } from './gltf-error';

export { isGlb, readGlb } from './glb';
export type { GlbContainer } from './glb';

export { parseGltf } from './parse';
export type { ParsedGltf } from './parse';

export { SUPPORTED_EXTENSIONS, assertSupportedExtensions } from './extensions';

export { resolveBuffers, sliceBufferView } from './buffers';
export type { SiblingReader } from './buffers';

export { decodeAccessor } from './accessor';
export type { DecodedAccessor, DecodedAccessorArray } from './accessor';

export { detectImageMime } from './image-source';
export type { SupportedImageMime, ImageMimeHint } from './image-source';

export { createImageBitmapDecoder } from './image-decoder';
export type { ImageDecoder, DecodedImagePixels } from './image-decoder';

export { mapPrimitiveMode } from './topology';
export { mapSampler } from './sampler';
export { mapPrimitiveToMesh } from './mesh-mapping';
export { mapMaterialToStandardMaterial } from './material-mapping';
export { createImageResolver } from './image-mapping';
export type { ImageResolver, ImageColorSpace } from './image-mapping';
export { mapGltfAssets } from './asset-mapping';
export { mapAnimations, gltfNodeTargetId } from './animation-mapping';
export type {
  GltfAssetStores,
  MappedGltfAssets,
  MappedMesh,
  MappedPrimitive,
} from './asset-mapping';

export type {
  GltfDocument,
  GltfAsset,
  GltfMaterial,
  GltfPbrMetallicRoughness,
  GltfTextureInfo,
  GltfNormalTextureInfo,
  GltfOcclusionTextureInfo,
  GltfTexture,
  GltfImage,
  GltfSampler,
  GltfAccessor,
  GltfAccessorSparse,
  GltfBufferView,
  GltfBuffer,
  GltfComponentType,
  GltfAccessorType,
  GltfAlphaMode,
  GltfAnimation,
  GltfAnimationChannel,
  GltfAnimationChannelTarget,
  GltfAnimationSampler,
  GltfInterpolation,
} from './schema';

export { Gltfs } from './gltf-root';
export type { Gltf, GltfNode, GltfScene, GltfMesh, GltfPrimitive } from './gltf-root';

export { buildGltfRoot } from './build-gltf-root';
export { createGltfImporter } from './gltf-importer';

export { GltfSceneRoot, GltfInstanceNodes } from './gltf-components';

export { addGltfInstantiation, addGltfReinstantiation } from './gltf-instantiate';

export type { GltfNodeAnchor } from './gltf-anchor';
export { resolveGltfNodeAnchor, gltfAnchorForEntity } from './gltf-anchor';

export { addGltfAttach, GLTF_NODE_ANCHOR_KIND } from './gltf-attach';

export { GltfPlugin } from './gltf-plugin';
export type { GltfPluginOptions } from './gltf-plugin';

export { GLTF_ASSET_KIND, gltfAssetKindDescriptor } from './gltf-asset-kind';
