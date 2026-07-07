import type { SamplerDescriptor } from '@retro-engine/renderer-core';

import type { ImageColorSpace } from './image';

/**
 * How a texture is sampled between texels:
 * - `'nearest'` — point sampling; crisp, blocky. The pixel-art default.
 * - `'linear'` — bilinear; smooth. The photographic / 3D default.
 *
 * (Trilinear — smooth *across* mip levels — additionally needs mipmaps, a later
 * import-settings phase; this maps only the min/mag filter.)
 */
export type TextureFilter = 'nearest' | 'linear';

/**
 * How UVs outside `[0, 1]` wrap:
 * - `'repeat'` — tile.
 * - `'clamp'` — hold the edge texel.
 * - `'mirror'` — tile, mirrored each repeat.
 */
export type TextureWrap = 'repeat' | 'clamp' | 'mirror';

/**
 * Per-texture import settings — how a decoded image is sampled and interpreted.
 * All optional; omitted fields take the defaults below. A serializable plain
 * shape (the eventual `.meta` sidecar), consumed when building an {@link Image}.
 *
 * `colorSpace` is the one setting that cannot be inferred from the file: a
 * base-color PNG is `'srgb'`, but a normal / metallic-roughness / occlusion map
 * stored in the same format is `'linear'` data — authored, not guessed.
 */
export interface TextureImportSettings {
  /** Min/mag filter. Default `'linear'`. */
  readonly filter?: TextureFilter;
  /** UV wrap on both axes. Default `'clamp'`. */
  readonly wrap?: TextureWrap;
  /** How the pixel bytes are interpreted. Default `'srgb'`. */
  readonly colorSpace?: ImageColorSpace;
}

const WRAP_TO_ADDRESS: Record<TextureWrap, 'clamp-to-edge' | 'repeat' | 'mirror-repeat'> = {
  repeat: 'repeat',
  clamp: 'clamp-to-edge',
  mirror: 'mirror-repeat',
};

/**
 * Build the {@link SamplerDescriptor} for a texture from its import settings:
 * the filter drives min/mag, the wrap drives both address modes. Pure.
 */
export const resolveTextureSampler = (settings: TextureImportSettings = {}): SamplerDescriptor => {
  const filter = settings.filter ?? 'linear';
  const address = WRAP_TO_ADDRESS[settings.wrap ?? 'clamp'];
  return { magFilter: filter, minFilter: filter, addressModeU: address, addressModeV: address };
};

/** The color-space interpretation for a texture's bytes; defaults to `'srgb'`. */
export const resolveTextureColorSpace = (settings: TextureImportSettings = {}): ImageColorSpace =>
  settings.colorSpace ?? 'srgb';

const FILTERS: readonly TextureFilter[] = ['nearest', 'linear'];
const WRAPS: readonly TextureWrap[] = ['repeat', 'clamp', 'mirror'];
const COLOR_SPACES: readonly ImageColorSpace[] = ['srgb', 'linear'];

/**
 * Parse a texture `.meta` sidecar (UTF-8 JSON) into {@link TextureImportSettings},
 * keeping only recognized fields with valid values — an unknown or malformed
 * field is dropped rather than throwing, so a partial or hand-edited `.meta`
 * still yields usable settings (merge the result over the importer default).
 * Throws only if the bytes are not valid JSON.
 */
export const parseTextureMeta = (bytes: Uint8Array): TextureImportSettings => {
  const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const out: {
    filter?: TextureFilter;
    wrap?: TextureWrap;
    colorSpace?: ImageColorSpace;
  } = {};
  if (FILTERS.includes(obj.filter as TextureFilter)) out.filter = obj.filter as TextureFilter;
  if (WRAPS.includes(obj.wrap as TextureWrap)) out.wrap = obj.wrap as TextureWrap;
  if (COLOR_SPACES.includes(obj.colorSpace as ImageColorSpace)) {
    out.colorSpace = obj.colorSpace as ImageColorSpace;
  }
  return out;
};

/** The sibling `.meta` path for an asset location (`textures/wood.png` → `wood.png.meta`). */
export const textureMetaSibling = (assetPath: string): string => {
  const slash = assetPath.lastIndexOf('/');
  const base = slash === -1 ? assetPath : assetPath.slice(slash + 1);
  return `${base}.meta`;
};
