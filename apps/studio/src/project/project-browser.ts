import type { AssetManifest } from '@retro-engine/assets';
import type { AssetType } from '@retro-engine/editor-sdk';
import type { AssetKinds } from '@retro-engine/engine';

import type { ThumbnailService } from '../thumbnails/thumbnail-service';

const IMAGE_EXT = /\.(png|jpe?g|webp|ktx2|basis|hdr)$/i;
const MESH_EXT = /\.rmesh$/i;
const GLTF_EXT = /\.(glb|gltf)$/i;

/** Maps an asset-kind descriptor's `category` hint to the browser's {@link AssetType}. */
const CATEGORY_TO_ASSET_TYPE: Readonly<Record<string, AssetType>> = {
  image: 'image',
  mesh: 'mesh',
  model: 'model',
  material: 'material',
  scene: 'scene',
  prefab: 'prefab',
  bundle: 'bundle',
  sprite: 'sprite',
  animation: 'animation',
  morph: 'morph',
};

/** One asset in the project asset browser, derived from the scanned `.meta` manifest. */
export interface BrowserAsset {
  readonly name: string;
  readonly type: AssetType;
  readonly guid: string;
  readonly location: string;
  readonly meta?: string;
  /** Whether a real preview can be generated for it today (an image). */
  readonly thumbnailable: boolean;
  /**
   * Derived children the importer extracts from this source — a model's meshes,
   * materials, and animation clips; a texture's sprites. Each child is a full
   * {@link BrowserAsset} with its own `type`, addressed by a sub-asset GUID so it
   * can be assigned and survive reload. One level deep; absent for leaf assets.
   * Populated on demand (see the model sub-asset service), not by the static scan.
   */
  readonly subs?: readonly BrowserAsset[];
}

/** The live asset browser for an open project: its assets + the thumbnail generator. */
export interface ProjectBrowser {
  /** The browsable assets; reassigned when a new asset (e.g. an authored bundle) is created in-session. */
  assets: readonly BrowserAsset[];
  readonly thumbnails: ThumbnailService;
}

const basename = (location: string): string => location.slice(location.lastIndexOf('/') + 1);

const typeFor = (kind: string, location: string, kinds?: AssetKinds): AssetType => {
  // The kind's registered descriptor is the source of truth for its UI category;
  // the switch below is the fallback for kinds whose plugin isn't loaded here.
  const category = kinds?.get(kind)?.category;
  const mapped = category !== undefined ? CATEGORY_TO_ASSET_TYPE[category] : undefined;
  if (mapped !== undefined) return mapped;
  switch (kind) {
    case 'Image':
      return 'image';
    case 'Mesh':
      return 'mesh';
    case 'Gltf':
      return 'model';
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
export const buildBrowserAssets = (manifest: AssetManifest, kinds?: AssetKinds): BrowserAsset[] => {
  const out: BrowserAsset[] = [];
  for (const entry of manifest.entries.values()) {
    const type = typeFor(entry.kind, entry.location, kinds);
    out.push({
      name: basename(entry.location),
      type,
      guid: entry.guid,
      location: entry.location,
      meta: entry.kind,
      // Previewable today: images (decode), `.rmesh` meshes (CPU flat-shade),
      // `.remat` materials (CPU shaded sphere), and `.glb`/`.gltf` models (CPU
      // flat-shade of the merged scene geometry).
      thumbnailable:
        type === 'image' ||
        type === 'material' ||
        IMAGE_EXT.test(entry.location) ||
        MESH_EXT.test(entry.location) ||
        GLTF_EXT.test(entry.location),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
};
