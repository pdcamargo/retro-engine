import type { AssetType } from '@retro-engine/editor-sdk';

import type { AssetZoom } from '../state';

/**
 * Transient + lightly-persisted state for the Assets panel: the toolbar inputs
 * (search, zoom, type filter), the folder-tree selection and expansion, which
 * source files have their derived-asset drawer open, and the multi-select set.
 * Single selection stays on {@link StudioState.selected}; this is everything else
 * the browser owns.
 */
export interface AssetsPanelState {
  search: string;
  zoom: AssetZoom;
  /** Selected folder: `'all'` or a folder path. */
  folder: string;
  /** Folder-tree nodes the user expanded, keyed by path. */
  expandedFolders: Set<string>;
  /** Active type filters; empty means "all types". */
  typeFilter: Set<AssetType>;
  /** Source files whose derived-asset drawer is open, keyed by GUID. */
  expandedAssets: Set<string>;
  /** Multi-selected assets, keyed by GUID. */
  multiSelect: Set<string>;
  /** Whether the folder-tree sidebar is hidden (reclaims its width for the grid). */
  treeCollapsed: boolean;
}

/** Build the panel's initial state. */
export const createAssetsPanelState = (): AssetsPanelState => ({
  search: '',
  zoom: 'md',
  folder: 'all',
  expandedFolders: new Set(),
  typeFilter: new Set(),
  expandedAssets: new Set(),
  multiSelect: new Set(),
  treeCollapsed: false,
});

const ZOOM_KEY = 'retro-studio.assets.zoom';
const TYPES_KEY = 'retro-studio.assets.typeFilter';
const TREE_KEY = 'retro-studio.assets.treeCollapsed';
const ZOOMS: readonly AssetZoom[] = ['list', 'sm', 'md', 'lg'];

const localStore = (): Storage | undefined => (globalThis as { localStorage?: Storage }).localStorage;

/** Load persisted zoom + type filter (no-op without `localStorage`). */
export const loadAssetsPrefs = (st: AssetsPanelState): void => {
  try {
    const store = localStore();
    if (store === undefined) return;
    const zoom = store.getItem(ZOOM_KEY);
    if (zoom !== null && (ZOOMS as readonly string[]).includes(zoom)) st.zoom = zoom as AssetZoom;
    const types = store.getItem(TYPES_KEY);
    if (types !== null) {
      st.typeFilter.clear();
      for (const t of JSON.parse(types) as AssetType[]) st.typeFilter.add(t);
    }
    st.treeCollapsed = store.getItem(TREE_KEY) === '1';
  } catch {
    /* prefs are best-effort */
  }
};

/** Persist zoom + type filter (no-op without `localStorage`). */
export const saveAssetsPrefs = (st: AssetsPanelState): void => {
  try {
    const store = localStore();
    if (store === undefined) return;
    store.setItem(ZOOM_KEY, st.zoom);
    store.setItem(TYPES_KEY, JSON.stringify([...st.typeFilter]));
    store.setItem(TREE_KEY, st.treeCollapsed ? '1' : '0');
  } catch {
    /* prefs are best-effort */
  }
};
