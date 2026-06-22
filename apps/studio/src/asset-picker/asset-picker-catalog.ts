import type { AssetType } from '@retro-engine/editor-sdk';

import type { BrowserAsset } from '../project/project-browser';
import type { AssetSort } from './asset-picker-state';

/**
 * What a slot's expected handle store accepts: the browser asset types
 * assignable to it (`null` = any type, free browse) and a friendly noun for the
 * picker title. The expected type is the schema's `t.handle(assetType)` store
 * name — `'Image'`, `'Mesh'`, a material store name, etc.
 */
export interface AssetTypeSpec {
  /** Browser asset types assignable here, or `null` to allow every type. */
  readonly types: readonly AssetType[] | null;
  /** Title noun, e.g. `Texture` / `Mesh` / `Material` / `Asset`. */
  readonly noun: string;
}

/** Resolve the {@link AssetTypeSpec} for a schema handle store name (or `null` for Any). */
export const assetTypeSpec = (storeType: string | null): AssetTypeSpec => {
  if (storeType === null) return { types: null, noun: 'Asset' };
  switch (storeType) {
    case 'Image':
      return { types: ['image'], noun: 'Texture' };
    case 'Mesh':
      return { types: ['mesh', 'model'], noun: 'Mesh' };
    case 'TextureAtlasLayout':
      return { types: [], noun: 'Atlas Layout' };
    default:
      // Each material class owns a store keyed `Materials<…>` / `Materials2d<…>`.
      if (storeType.includes('Material')) return { types: ['material'], noun: 'Material' };
      return { types: null, noun: storeType };
  }
};

/** Whether an asset is assignable under a spec. */
export const isCompatible = (asset: BrowserAsset, spec: AssetTypeSpec): boolean =>
  spec.types === null || spec.types.includes(asset.type);

/** The folder a `location` lives in (its path minus the file name); `''` at the root. */
export const folderOf = (location: string): string => {
  const slash = location.lastIndexOf('/');
  return slash === -1 ? '' : location.slice(0, slash);
};

/** One folder in the picker's nested tree: its path, item count (subtree), and children. */
export interface FolderNode {
  readonly name: string;
  readonly path: string;
  count: number;
  readonly children: Map<string, FolderNode>;
}

/**
 * Build the nested folder tree from a pool of assets, by splitting each asset's
 * folder into segments. Every node's `count` is the number of assets anywhere in
 * its subtree. Returns a synthetic root whose `children` are the top folders.
 */
export const buildFolderTree = (assets: readonly BrowserAsset[]): FolderNode => {
  const root: FolderNode = { name: '', path: '', count: 0, children: new Map() };
  for (const asset of assets) {
    const folder = folderOf(asset.location);
    if (folder === '') continue;
    let node = root;
    let acc = '';
    for (const seg of folder.split('/')) {
      acc = acc === '' ? seg : `${acc}/${seg}`;
      let child = node.children.get(seg);
      if (child === undefined) {
        child = { name: seg, path: acc, count: 0, children: new Map() };
        node.children.set(seg, child);
      }
      child.count++;
      node = child;
    }
  }
  return root;
};

/** The smart-folder selections the tree offers above the real folders. */
export type SmartFolder = 'all' | 'fav' | 'recent';

/** Inputs that narrow the browsable pool to the assets shown in the grid. */
export interface AssetFilter {
  readonly spec: AssetTypeSpec;
  /** `'all'` / `'fav'` / `'recent'`, or a real folder path. */
  readonly folder: string;
  /** `'all'` or a specific {@link AssetType}. */
  readonly typeFilter: string;
  readonly query: string;
  readonly favorites: ReadonlySet<string>;
  readonly recent: readonly string[];
}

const inFolder = (asset: BrowserAsset, folder: string): boolean => {
  const f = folderOf(asset.location);
  return f === folder || f.startsWith(`${folder}/`);
};

/** Apply the type-lock, folder, type-chip, and search filters in order. */
export const filterAssets = (assets: readonly BrowserAsset[], f: AssetFilter): BrowserAsset[] => {
  const query = f.query.trim().toLowerCase();
  return assets.filter((a) => {
    if (!isCompatible(a, f.spec)) return false;
    if (f.folder === 'fav') {
      if (!f.favorites.has(a.guid)) return false;
    } else if (f.folder === 'recent') {
      if (!f.recent.includes(a.guid)) return false;
    } else if (f.folder !== 'all' && !inFolder(a, f.folder)) {
      return false;
    }
    if (f.typeFilter !== 'all' && a.type !== f.typeFilter) return false;
    if (query !== '' && !a.name.toLowerCase().includes(query) && !a.type.includes(query)) return false;
    return true;
  });
};

/** Sort a filtered list by name, type (then name), or recency (then name). */
export const sortAssets = (list: BrowserAsset[], sort: AssetSort, recent: readonly string[]): BrowserAsset[] => {
  const byName = (a: BrowserAsset, b: BrowserAsset): number => a.name.localeCompare(b.name);
  if (sort === 'type') return list.sort((a, b) => a.type.localeCompare(b.type) || byName(a, b));
  if (sort === 'recent') {
    const rank = (guid: string): number => {
      const i = recent.indexOf(guid);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return list.sort((a, b) => rank(a.guid) - rank(b.guid) || byName(a, b));
  }
  return list.sort(byName);
};

/** Distinct asset types present in the compatible pool, for scoping the filter chips. */
export const presentTypes = (assets: readonly BrowserAsset[], spec: AssetTypeSpec): AssetType[] => {
  const order: AssetType[] = [
    'image',
    'texture',
    'sprite',
    'material',
    'mesh',
    'model',
    'scene',
    'prefab',
    'bundle',
    'audio',
    'script',
  ];
  const present = new Set<AssetType>();
  for (const a of assets) if (isCompatible(a, spec)) present.add(a.type);
  return order.filter((t) => present.has(t));
};
