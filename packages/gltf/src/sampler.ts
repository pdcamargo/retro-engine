import type { SamplerDescriptor } from '@retro-engine/renderer-core';

import type { GltfSampler } from './schema';

type AddressMode = NonNullable<SamplerDescriptor['addressModeU']>;
type FilterMode = NonNullable<SamplerDescriptor['magFilter']>;

const mapWrap = (wrap: number | undefined): AddressMode => {
  switch (wrap) {
    case 33071:
      return 'clamp-to-edge';
    case 33648:
      return 'mirror-repeat';
    // 10497 REPEAT, and the glTF default when wrap is omitted.
    default:
      return 'repeat';
  }
};

const mapMagFilter = (filter: number | undefined): FilterMode =>
  filter === 9728 ? 'nearest' : 'linear';

/**
 * glTF min-filter enums fold the minification filter and the mipmap filter into
 * one value. Split them: `9728`/`9729` are mip-less nearest/linear; the
 * `9984`–`9987` family encodes `<min>_MIPMAP_<mip>`.
 */
const mapMinFilter = (
  filter: number | undefined,
): { minFilter: FilterMode; mipmapFilter: FilterMode } => {
  switch (filter) {
    case 9728:
      return { minFilter: 'nearest', mipmapFilter: 'linear' };
    case 9984: // NEAREST_MIPMAP_NEAREST
      return { minFilter: 'nearest', mipmapFilter: 'nearest' };
    case 9986: // NEAREST_MIPMAP_LINEAR
      return { minFilter: 'nearest', mipmapFilter: 'linear' };
    case 9985: // LINEAR_MIPMAP_NEAREST
      return { minFilter: 'linear', mipmapFilter: 'nearest' };
    // 9729 LINEAR, 9987 LINEAR_MIPMAP_LINEAR, and the default.
    default:
      return { minFilter: 'linear', mipmapFilter: 'linear' };
  }
};

/**
 * Builds a {@link SamplerDescriptor} from a glTF sampler. When the texture has
 * no sampler, glTF leaves wrap/filter to the implementation; the returned
 * descriptor uses repeat addressing and linear filtering — the engine's default
 * for an authored color texture.
 */
export const mapSampler = (sampler?: GltfSampler): SamplerDescriptor => {
  const { minFilter, mipmapFilter } = mapMinFilter(sampler?.minFilter);
  return {
    addressModeU: mapWrap(sampler?.wrapS),
    addressModeV: mapWrap(sampler?.wrapT),
    magFilter: mapMagFilter(sampler?.magFilter),
    minFilter,
    mipmapFilter,
  };
};
