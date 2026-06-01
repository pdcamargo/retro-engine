import type { AlphaMode, Handle, Image as ImageType } from '@retro-engine/engine';
import { StandardMaterial } from '@retro-engine/engine';
import { vec4 } from '@retro-engine/math';

import type { ImageColorSpace, ImageResolver } from './image-mapping';
import { mapSampler } from './sampler';
import type { GltfDocument, GltfMaterial, GltfTextureInfo } from './schema';

const mapAlphaMode = (mode: GltfMaterial['alphaMode'], cutoff: number): AlphaMode => {
  switch (mode) {
    case 'MASK':
      return { kind: 'mask', cutoff };
    case 'BLEND':
      return 'blend';
    // 'OPAQUE' and the glTF default.
    default:
      return 'opaque';
  }
};

/**
 * Maps a glTF material onto an engine {@link StandardMaterial}, covering the
 * full metallic-roughness model: base color (factor + texture), metallic and
 * roughness factors, the metallic-roughness texture, the normal texture with its
 * scale, the occlusion texture with its strength, emissive (factor + texture),
 * alpha mode + cutoff, and double-sided.
 *
 * Per-slot color space follows the glTF rule: base-color and emissive textures
 * are sampled as `srgb`; normal, metallic-roughness, and occlusion textures as
 * `linear`. Texture references are resolved (and deduped) through `resolver`.
 * Only TEXCOORD_0 is supported; a non-zero `texCoord` is ignored.
 *
 * glTF factor defaults differ from the engine constructor defaults and are
 * applied explicitly: absent `metallicFactor` / `roughnessFactor` mean `1`.
 */
export const mapMaterialToStandardMaterial = async (
  document: GltfDocument,
  material: GltfMaterial,
  resolver: ImageResolver,
): Promise<StandardMaterial> => {
  const resolveSlot = async (
    info: GltfTextureInfo | undefined,
    colorSpace: ImageColorSpace,
  ): Promise<Handle<ImageType> | undefined> => {
    if (info === undefined) return undefined;
    const texture = document.textures?.[info.index];
    if (texture?.source === undefined) return undefined;
    const sampler = texture.sampler !== undefined ? document.samplers?.[texture.sampler] : undefined;
    return resolver.resolve(texture.source, colorSpace, mapSampler(sampler));
  };

  const pbr = material.pbrMetallicRoughness;
  const cutoff = material.alphaCutoff ?? 0.5;
  const [er, eg, eb] = material.emissiveFactor ?? [0, 0, 0];

  // Resolve sequentially so the resolver's dedup cache stays correct (a shared
  // image must not be decoded twice by two slots racing past the cache miss).
  const baseColorTexture = await resolveSlot(pbr?.baseColorTexture, 'srgb');
  const metallicRoughnessTexture = await resolveSlot(pbr?.metallicRoughnessTexture, 'linear');
  const normalMapTexture = await resolveSlot(material.normalTexture, 'linear');
  const occlusionTexture = await resolveSlot(material.occlusionTexture, 'linear');
  const emissiveTexture = await resolveSlot(material.emissiveTexture, 'srgb');

  return new StandardMaterial({
    baseColor: vec4.create(...(pbr?.baseColorFactor ?? [1, 1, 1, 1])),
    emissive: vec4.create(er, eg, eb, 1),
    metallic: pbr?.metallicFactor ?? 1,
    roughness: pbr?.roughnessFactor ?? 1,
    occlusionStrength: material.occlusionTexture?.strength ?? 1,
    normalScale: material.normalTexture?.scale ?? 1,
    alphaCutoff: cutoff,
    alphaMode: mapAlphaMode(material.alphaMode, cutoff),
    doubleSided: material.doubleSided ?? false,
    ...(baseColorTexture !== undefined ? { baseColorTexture } : {}),
    ...(metallicRoughnessTexture !== undefined ? { metallicRoughnessTexture } : {}),
    ...(normalMapTexture !== undefined ? { normalMapTexture } : {}),
    ...(occlusionTexture !== undefined ? { occlusionTexture } : {}),
    ...(emissiveTexture !== undefined ? { emissiveTexture } : {}),
  });
};
