import type { AssetType } from '@retro-engine/editor-sdk';

import { folderOf } from '../asset-picker/asset-picker-catalog';
import type { BrowserAsset } from '../project/project-browser';

/** One top-level asset that passed the filters, plus how its drawer should render. */
export interface FilteredAsset {
  readonly asset: BrowserAsset;
  /** The children to show when the drawer is open (already narrowed by filters). */
  readonly matchedChildren: readonly BrowserAsset[];
  /** A child matched the search but the parent's own name did not — open the drawer. */
  readonly forceExpand: boolean;
}

/** Inputs that narrow the browser to the assets (and children) shown. */
export interface PanelFilter {
  /** `'all'` or a folder path. */
  readonly folder: string;
  /** Active type filters; empty = all types. */
  readonly typeFilter: ReadonlySet<AssetType>;
  /** Search query (matched against asset and child names). */
  readonly query: string;
  /** Resolve a source file's derived children (lazy for models), or `undefined`. */
  readonly subsOf: (asset: BrowserAsset) => readonly BrowserAsset[] | undefined;
}

const inFolder = (asset: BrowserAsset, folder: string): boolean => {
  const f = folderOf(asset.location);
  return f === folder || f.startsWith(`${folder}/`);
};

/**
 * Apply folder, type, and search filters — each derivation-aware. An asset
 * passes the type filter if its own type or any child's type is selected; it
 * passes search if its name or any child's name matches. A child-only search
 * match force-expands the drawer and narrows it to the matching children.
 */
export const filterAssetsForPanel = (
  assets: readonly BrowserAsset[],
  f: PanelFilter,
): FilteredAsset[] => {
  const query = f.query.trim().toLowerCase();
  const noTypes = f.typeFilter.size === 0;
  const out: FilteredAsset[] = [];

  for (const asset of assets) {
    if (f.folder !== 'all' && !inFolder(asset, f.folder)) continue;

    const subs = f.subsOf(asset) ?? asset.subs ?? [];

    // Type gate: parent type selected, or some child type selected.
    const parentTypeOk = noTypes || f.typeFilter.has(asset.type);
    const childTypeOk = !noTypes && subs.some((c) => f.typeFilter.has(c.type));
    if (!parentTypeOk && !childTypeOk) continue;

    // When filtering by child types the parent doesn't have, narrow the drawer
    // to the selected child types; otherwise keep every child.
    const children = parentTypeOk ? subs : subs.filter((c) => f.typeFilter.has(c.type));

    if (query === '') {
      out.push({ asset, matchedChildren: children, forceExpand: false });
      continue;
    }

    const nameMatch = asset.name.toLowerCase().includes(query);
    if (nameMatch) {
      out.push({ asset, matchedChildren: children, forceExpand: false });
      continue;
    }
    const childMatches = children.filter((c) => c.name.toLowerCase().includes(query));
    if (childMatches.length > 0) {
      out.push({ asset, matchedChildren: childMatches, forceExpand: true });
    }
  }

  return out;
};

const TYPE_ORDER: readonly AssetType[] = [
  'image',
  'texture',
  'sprite',
  'material',
  'mesh',
  'model',
  'scene',
  'prefab',
  'bundle',
  'animation',
  'audio',
  'script',
  'shader',
  'particle',
  'font',
];

/** Distinct types present across the top-level assets and their children, in display order. */
export const presentTypesForPanel = (
  assets: readonly BrowserAsset[],
  subsOf: (asset: BrowserAsset) => readonly BrowserAsset[] | undefined,
): AssetType[] => {
  const present = new Set<AssetType>();
  for (const a of assets) {
    present.add(a.type);
    for (const c of subsOf(a) ?? a.subs ?? []) present.add(c.type);
  }
  return TYPE_ORDER.filter((t) => present.has(t));
};
