import {
  type AssetActionHost,
  type AssetActionRegistry,
  type AssetActionTarget,
  type AssetCardEditing,
  type AssetType,
  type EditorContext,
} from '@retro-engine/editor-sdk';

import type { BrowserAsset, ProjectBrowser } from '../project/project-browser';
import { tileFor, type StudioState } from '../state';

import { ASSET_KIND_VISUALS } from './asset-kind-visuals';
import type { AssetsPanelState } from './assets-panel-state';
import type { FilteredAsset } from './assets-filter';

const GAP = 14;
/** Stable ImGui id for the transient create card (there is at most one). */
const DRAFT_ID = '__draft__';

const plural = (n: number, noun: string): string => {
  if (n === 1) return `1 ${noun}`;
  const p = /(?:s|sh|ch|x|z)$/.test(noun) ? `${noun}es` : `${noun}s`;
  return `${n} ${p}`;
};

const SUMMARY_ORDER: readonly AssetType[] = ['mesh', 'material', 'animation', 'sprite', 'image', 'texture'];
const NOUN: Partial<Record<AssetType, string>> = {
  mesh: 'mesh',
  material: 'material',
  animation: 'animation',
  sprite: 'sprite',
  image: 'texture',
  texture: 'texture',
};

/** "6 meshes · 3 materials · 2 animations" from a child list. */
const summaryOf = (children: readonly BrowserAsset[]): string => {
  const counts = new Map<AssetType, number>();
  for (const c of children) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  const parts: string[] = [];
  for (const t of SUMMARY_ORDER) {
    const n = counts.get(t);
    if (n !== undefined) parts.push(plural(n, NOUN[t] ?? t));
  }
  return parts.length > 0 ? parts.join(' · ') : plural(children.length, 'item');
};

const columns = (ui: EditorContext['ui'], tile: number): number =>
  Math.max(1, Math.floor((ui.contentAvail()[0] + GAP) / (tile + GAP)));

/** Directory of a project-relative path (no trailing slash; `''` at the root). */
const dirOf = (location: string): string => {
  const i = location.lastIndexOf('/');
  return i >= 0 ? location.slice(0, i) : '';
};
/** File name of a project-relative path. */
const fileNameOf = (location: string): string => location.slice(location.lastIndexOf('/') + 1);
/** Extension (with leading dot) of a path, or `''`. */
const extOf = (location: string): string => {
  const name = fileNameOf(location);
  const d = name.lastIndexOf('.');
  return d > 0 ? name.slice(d) : '';
};
/** Base name of a path (file name without its extension). */
const baseOf = (location: string): string => {
  const name = fileNameOf(location);
  const d = name.lastIndexOf('.');
  return d > 0 ? name.slice(0, d) : name;
};

const targetOf = (asset: BrowserAsset, isChild: boolean): AssetActionTarget => ({
  guid: asset.guid,
  name: asset.name,
  type: asset.type,
  assetKind: asset.meta ?? asset.type,
  location: asset.location,
  isChild,
});

/** Hooks the grid needs from the panel: the action registry/host, follow-ups, and inline edits. */
export interface GridActions {
  /** The asset-action registry (built-in + user actions) used to build context menus. */
  readonly registry: AssetActionRegistry;
  /** Panel operations actions reach back into (inline create/rename, delete). */
  readonly host: AssetActionHost;
  /** The resolved folder new assets are created in (the browse folder, `'all'` → `'assets'`). */
  readonly folder: string;
  /** Whether `dir` already holds a file named `filename` (optionally excluding `exceptGuid`). */
  readonly duplicate: (dir: string, filename: string, exceptGuid?: string) => boolean;
  /** Commit an inline rename: rename the asset's base name to `newBase`. */
  readonly renameAsset: (guid: string, newBase: string) => void;
  /** Activate (double-click / Open) an asset — e.g. open a bundle for editing. */
  readonly onActivate?: (asset: BrowserAsset) => void;
}

/** Compute the {@link AssetCardEditing} for an active rename, or `undefined`. */
const renameEditing = (st: AssetsPanelState, asset: BrowserAsset, actions: GridActions): AssetCardEditing | undefined => {
  if (st.renaming !== asset.guid) return undefined;
  const trimmed = st.editBuffer.trim();
  const error = trimmed.length > 0 && actions.duplicate(dirOf(asset.location), `${trimmed}${extOf(asset.location)}`, asset.guid);
  return { value: st.editBuffer, focus: st.editFocus, error, errorText: 'Name already exists' };
};

const renderCard = (
  ctx: EditorContext,
  st: AssetsPanelState,
  state: StudioState,
  browser: ProjectBrowser | null,
  asset: BrowserAsset,
  tile: number,
  isChild: boolean,
  actions: GridActions,
  subCount?: number,
): void => {
  const { widgets } = ctx;
  const thumbnail =
    !isChild && asset.thumbnailable && browser !== null
      ? browser.thumbnails.get(asset.guid, asset.location)
      : undefined;
  const visual = asset.meta !== undefined ? ASSET_KIND_VISUALS[asset.meta] : undefined;
  const editing = !isChild ? renameEditing(st, asset, actions) : undefined;
  const r = widgets.assetCard({
    id: asset.guid,
    name: asset.name,
    type: asset.type,
    meta: isChild ? undefined : asset.meta,
    tile,
    thumbnail,
    ...(visual !== undefined ? { icon: visual.icon, tag: visual.tag, tone: visual.tone } : {}),
    selected: state.selected === asset.guid,
    checked: st.multiSelect.has(asset.guid),
    subCount,
    expanded: st.expandedAssets.has(asset.guid),
    ...(editing !== undefined ? { editing } : {}),
    // While renaming, the card owns the interaction — no context menu / drag.
    ...(editing === undefined
      ? {
          onContextMenu: (): void =>
            widgets.contextMenu(
              asset.guid,
              actions.registry.buildAssetMenu({ asset: targetOf(asset, isChild), folder: actions.folder, host: actions.host }),
            ),
          // Drag the asset onto a compatible inspector field, the hierarchy, or the
          // scene view. `assetKind` is the manifest kind (meta) for top-level files, or
          // the browser category for derived sub-assets that have no sidecar of their own.
          dnd: {
            source: {
              payload: {
                kind: 'asset',
                guid: asset.guid,
                assetKind: asset.meta ?? asset.type,
                assetType: asset.type,
                name: asset.name,
                ...(thumbnail !== undefined ? { thumbnail } : {}),
              },
            },
          },
        }
      : {}),
  });
  if (r.edit !== undefined) {
    // Inline rename in progress: apply the edit outcome, then stop (no select/expand).
    st.editBuffer = r.edit.value;
    if (r.edit.cancel) {
      st.renaming = null;
      st.editBuffer = '';
    } else if (r.edit.commit) {
      const next = r.edit.value.trim();
      if (next.length === 0) {
        st.renaming = null; // empty → treat as cancel
        st.editBuffer = '';
      } else if (editing?.error === true) {
        st.editFocus = true; // duplicate: keep the field open, refocus
      } else {
        actions.renameAsset(asset.guid, next);
        st.renaming = null;
        st.editBuffer = '';
      }
    } else {
      st.editFocus = false; // focus consumed for this session
    }
    return;
  }
  if (r.expandToggled) {
    if (st.expandedAssets.has(asset.guid)) st.expandedAssets.delete(asset.guid);
    else st.expandedAssets.add(asset.guid);
  } else if (r.checkToggled) {
    if (st.multiSelect.has(asset.guid)) st.multiSelect.delete(asset.guid);
    else st.multiSelect.add(asset.guid);
  } else if (r.clicked) {
    state.selected = asset.guid;
    // Selecting an asset drives the inspector (asset editor); clear the entity selection.
    state.selectedAsset = { assetType: asset.type, guid: asset.guid, assetKind: asset.meta ?? asset.type };
    state.selectedEntity = null;
    actions.onActivate?.(asset);
  } else if (r.rightClicked) {
    state.selected = asset.guid;
  }
};

/** Render the transient create card (a virtual, focused, editable tile). */
const renderDraftCard = (ctx: EditorContext, st: AssetsPanelState, tile: number, actions: GridActions): void => {
  const draft = st.draft;
  if (draft === null) return;
  const trimmed = st.editBuffer.trim();
  const error = trimmed.length > 0 && actions.duplicate(actions.folder, `${trimmed}.${draft.extension}`);
  const r = ctx.widgets.assetCard({
    id: DRAFT_ID,
    name: st.editBuffer,
    type: draft.type,
    tile,
    ...(draft.icon !== undefined ? { icon: draft.icon } : {}),
    ...(draft.tag !== undefined ? { tag: draft.tag } : {}),
    editing: { value: st.editBuffer, focus: st.editFocus, error, errorText: 'Name already exists' },
  });
  if (r.edit === undefined) return;
  st.editBuffer = r.edit.value;
  if (r.edit.cancel) {
    st.draft = null;
    st.editBuffer = '';
  } else if (r.edit.commit) {
    const next = r.edit.value.trim();
    if (next.length === 0) {
      st.draft = null; // empty → treat as cancel
      st.editBuffer = '';
    } else if (error) {
      st.editFocus = true; // duplicate: keep the field open, refocus
    } else {
      const folder = actions.folder;
      st.draft = null;
      st.editBuffer = '';
      void draft.create(next, folder);
    }
  } else {
    st.editFocus = false;
  }
};

const drawerHeight = (childCount: number, cols: number, tile: number): number => {
  const rows = Math.max(1, Math.ceil(childCount / cols));
  const cellH = tile + 38; // tile + two-line label
  return 44 + rows * cellH;
};

/**
 * Lay out the filtered assets as a wrapping tile grid, breaking a full-width
 * derived-asset drawer into its own row wherever a source file is expanded. In
 * list zoom every asset is a single-column row and an expanded source indents
 * its children below it. A pending create draft renders as the first tile.
 */
export const renderAssetsGrid = (
  ctx: EditorContext,
  st: AssetsPanelState,
  state: StudioState,
  browser: ProjectBrowser | null,
  items: readonly FilteredAsset[],
  actions: GridActions,
): void => {
  const { ui, widgets } = ctx;
  if (items.length === 0 && st.draft === null) {
    ui.dummy([0, 18]);
    const msg = st.search.trim() === '' ? 'No assets in this folder.' : `No assets match "${st.search.trim()}".`;
    ui.textDisabled(`   ${msg}`);
    return;
  }

  const list = st.zoom === 'list';
  const tile = list ? 28 : tileFor(st.zoom);

  if (list) {
    if (st.draft !== null) renderDraftCard(ctx, st, tile, actions);
    for (const fa of items) {
      const expanded = fa.matchedChildren.length > 0 && (fa.forceExpand || st.expandedAssets.has(fa.asset.guid));
      renderCard(ctx, st, state, browser, fa.asset, tile, false, actions, fa.matchedChildren.length || undefined);
      if (expanded) {
        ui.indent(18);
        for (const child of fa.matchedChildren) renderCard(ctx, st, state, browser, child, tile, true, actions);
        ui.unindent(18);
      }
    }
    return;
  }

  const cols = columns(ui, tile);
  let col = 0;
  if (st.draft !== null) {
    renderDraftCard(ctx, st, tile, actions);
    col = 1 % cols; // the draft occupies the first cell
  }
  for (const fa of items) {
    const expanded = fa.matchedChildren.length > 0 && (fa.forceExpand || st.expandedAssets.has(fa.asset.guid));
    if (expanded) {
      col = 0; // break the row: the drawer spans every column
      const children = fa.matchedChildren;
      widgets.assetGroup({
        id: fa.asset.guid,
        name: fa.asset.name,
        headerType: fa.asset.type,
        summary: summaryOf(children) + (fa.asset.meta !== undefined ? ` · ${fa.asset.meta}` : ''),
        tile,
        height: drawerHeight(children.length, Math.max(1, cols), tile),
        onCollapse: () => st.expandedAssets.delete(fa.asset.guid),
        body: () => {
          const innerCols = columns(ui, tile);
          let c = 0;
          for (const child of children) {
            if (c > 0) ui.sameLine();
            renderCard(ctx, st, state, browser, child, tile, true, actions);
            c = (c + 1) % Math.max(1, innerCols);
          }
        },
      });
      continue;
    }
    if (col > 0) ui.sameLine();
    renderCard(ctx, st, state, browser, fa.asset, tile, false, actions, fa.matchedChildren.length || undefined);
    col = (col + 1) % cols;
  }
};

/** Base name (no extension) of an asset by GUID, for seeding an inline rename. Exported for the panel. */
export const assetBaseName = (asset: BrowserAsset): string => baseOf(asset.location);
