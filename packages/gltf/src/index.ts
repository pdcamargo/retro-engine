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

export type {
  GltfDocument,
  GltfAsset,
  GltfScene,
  GltfNode,
  GltfMesh,
  GltfPrimitive,
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
} from './schema';
