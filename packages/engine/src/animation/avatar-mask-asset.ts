import type { AssetImporter, AssetSerializer } from '@retro-engine/assets';
import { Assets } from '@retro-engine/assets';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { AvatarMask } from './avatar-mask';

/** The {@link Assets} store holding imported/authored {@link AvatarMask}s. */
export class AvatarMasks extends Assets<AvatarMask> {}

/** Asset-kind tag and file extension for {@link AvatarMask}. */
export const AVATAR_MASK_ASSET_KIND = 'AvatarMask';

/** Current `.ramask` wire-format version. Bumped only on a breaking shape change. */
export const AVATAR_MASK_FORMAT_VERSION = 1;

interface AvatarMaskFile {
  readonly version: number;
  readonly name?: string;
  readonly included: readonly string[];
}

const encodeMask = (mask: AvatarMask): Uint8Array => {
  const file: AvatarMaskFile = {
    version: AVATAR_MASK_FORMAT_VERSION,
    ...(mask.name !== undefined ? { name: mask.name } : {}),
    included: mask.ids(),
  };
  return new TextEncoder().encode(stringifyYaml(file));
};

const decodeMask = (bytes: Uint8Array): AvatarMask => {
  const raw = parseYaml(new TextDecoder().decode(bytes)) as Partial<AvatarMaskFile>;
  if (raw.version !== AVATAR_MASK_FORMAT_VERSION) {
    throw new Error(
      `AvatarMask: unsupported format version ${String(raw.version)} (expected ${AVATAR_MASK_FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(raw.included)) {
    throw new Error('AvatarMask: payload is missing an included array');
  }
  return new AvatarMask(raw.included, raw.name);
};

/**
 * Build the {@link AssetImporter} that turns `.ramask` bytes (UTF-8 YAML) into an
 * {@link AvatarMask}. Synchronous — a mask is self-contained. YAML is a JSON
 * superset, so legacy JSON-encoded masks still load.
 */
export const createAvatarMaskImporter = (): AssetImporter<AvatarMask> => (bytes) => decodeMask(bytes);

/**
 * Build the {@link AssetSerializer} that round-trips an {@link AvatarMask} through
 * its canonical `.ramask` YAML form — the inverse of {@link createAvatarMaskImporter}.
 */
export const createAvatarMaskSerializer = (): AssetSerializer<AvatarMask> => ({
  serialize: (mask) => encodeMask(mask),
  deserialize: (bytes) => decodeMask(bytes),
});
