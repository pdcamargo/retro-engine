import type { Handle } from '@retro-engine/assets';

/** How the grid is sorted. */
export type AssetSort = 'name' | 'type' | 'recent';

/** Grid tile scale; `list` collapses to a single-column list. */
export type AssetPickerZoom = 'list' | 'sm' | 'md' | 'lg';

/** The commit callback an opener supplies — writes the chosen handle (or clears it). */
export type AssetCommit = (handle: Handle<unknown> | undefined) => void;

/**
 * The asset picker modal's full state: who opened it (the slot being assigned and
 * how to commit back), plus the transient browse state and session-local
 * favorites / recents. Lives on {@link StudioState}; the modal reads and mutates
 * it each frame, the inspector's handle field fills it on open.
 */
export interface AssetPickerState {
  open: boolean;
  /** Schema handle store name the slot expects, or `null` for free browse (Any). */
  allowedStoreType: string | null;
  /** GUID currently assigned to the slot, or `null` when unset. */
  currentGuid: string | null;
  /** Whether the slot may be cleared (an optional / nullable handle field). */
  canClear: boolean;
  entityLabel: string;
  componentLabel: string;
  propertyLabel: string;
  /** Writes the picked handle through the slot's edit boundary; `null` while closed. */
  commit: AssetCommit | null;

  query: string;
  /** `'all'` or a specific asset type. */
  typeFilter: string;
  sort: AssetSort;
  zoom: AssetPickerZoom;
  /** `'all'` / `'fav'` / `'recent'`, or a real folder path. */
  folder: string;
  expandedFolders: Set<string>;
  focusedGuid: string | null;
  selectedGuid: string | null;

  /** Session-local across opens (persistence is a later slice). */
  favorites: Set<string>;
  recent: string[];
}

/** What opening the picker for a slot requires. */
export interface OpenAssetPickerRequest {
  readonly allowedStoreType: string | null;
  readonly currentGuid: string | null;
  readonly canClear: boolean;
  readonly entityLabel: string;
  readonly componentLabel: string;
  readonly propertyLabel: string;
  readonly commit: AssetCommit;
}

/** The picker's initial (closed) state; favorites/recents persist for the session. */
export const createAssetPickerState = (): AssetPickerState => ({
  open: false,
  allowedStoreType: null,
  currentGuid: null,
  canClear: false,
  entityLabel: '',
  componentLabel: '',
  propertyLabel: '',
  commit: null,
  query: '',
  typeFilter: 'all',
  sort: 'name',
  zoom: 'md',
  folder: 'all',
  expandedFolders: new Set(),
  focusedGuid: null,
  selectedGuid: null,
  favorites: new Set(),
  recent: [],
});

const RECENT_CAP = 12;

/** Open the picker for a slot, resetting browse state but keeping favorites/recents. */
export const openAssetPicker = (state: AssetPickerState, req: OpenAssetPickerRequest): void => {
  state.open = true;
  state.allowedStoreType = req.allowedStoreType;
  state.currentGuid = req.currentGuid;
  state.canClear = req.canClear;
  state.entityLabel = req.entityLabel;
  state.componentLabel = req.componentLabel;
  state.propertyLabel = req.propertyLabel;
  state.commit = req.commit;
  state.query = '';
  state.typeFilter = 'all';
  state.folder = 'all';
  state.focusedGuid = req.currentGuid;
  state.selectedGuid = req.currentGuid;
};

/** Close the picker and drop the commit binding so a stale slot can't be written. */
export const closeAssetPicker = (state: AssetPickerState): void => {
  state.open = false;
  state.commit = null;
};

/** Record a GUID as most-recently used (deduped, newest first, capped). */
export const pushRecent = (state: AssetPickerState, guid: string): void => {
  state.recent = [guid, ...state.recent.filter((g) => g !== guid)].slice(0, RECENT_CAP);
};
