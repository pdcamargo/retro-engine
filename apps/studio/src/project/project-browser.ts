import type { AssetManifest } from '@retro-engine/assets';
import type { AssetType } from '@retro-engine/editor-sdk';

import type { ThumbnailService } from '../thumbnails/thumbnail-service';

const IMAGE_EXT = /\.(png|jpe?g|webp|ktx2|basis|hdr)$/i;
const MESH_EXT = /\.rmesh$/i;

/** One asset in the project asset browser, derived from the scanned `.meta` manifest. */
export interface BrowserAsset {
  readonly name: string;
  readonly type: AssetType;
  readonly guid: string;
  readonly location: string;
  readonly meta?: string;
  /** Whether a real preview can be generated for it today (an image). */
  readonly thumbnailable: boolean;
}

/** The live asset browser for an open project: its assets + the thumbnail generator. */
export interface ProjectBrowser {
  /** The browsable assets; reassigned when a new asset (e.g. an authored bundle) is created in-session. */
  assets: readonly BrowserAsset[];
  readonly thumbnails: ThumbnailService;
}

const basename = (location: string): string => location.slice(location.lastIndexOf('/') + 1);

const typeFor = (kind: string, location: string): AssetType => {
  switch (kind) {
    case 'Image':
      return 'image';
    case 'Mesh':
      return 'mesh';
    case 'Scene':
      return 'scene';
    case 'Prefab':
      return 'prefab';
    case 'Bundle':
      return 'bundle';
    default:
      break;
  }
  if (kind.endsWith('Material')) return 'material';
  if (IMAGE_EXT.test(location)) return 'image';
  return 'folder';
};

/** Build the asset-browser list from a project's scanned manifest, sorted by name. */
export const buildBrowserAssets = (manifest: AssetManifest): BrowserAsset[] => {
  const out: BrowserAsset[] = [];
  for (const entry of manifest.entries.values()) {
    const type = typeFor(entry.kind, entry.location);
    out.push({
      name: basename(entry.location),
      type,
      guid: entry.guid,
      location: entry.location,
      meta: entry.kind,
      // Previewable today: images (decode), `.rmesh` meshes (CPU flat-shade), and
      // `.remat` materials (CPU shaded sphere).
      thumbnailable:
        type === 'image' ||
        type === 'material' ||
        IMAGE_EXT.test(entry.location) ||
        MESH_EXT.test(entry.location),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
};
