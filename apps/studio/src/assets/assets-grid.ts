import { type AssetType, type EditorContext } from '@retro-engine/editor-sdk';

import type { BrowserAsset, ProjectBrowser } from '../project/project-browser';
import { tileFor, type StudioState } from '../state';

import { type AssetMenuActions, buildAssetMenu } from './assets-context-menu';
import type { AssetsPanelState } from './assets-panel-state';
import type { FilteredAsset } from './assets-filter';

const GAP = 14;

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

/** Hooks the grid needs from the panel: selection follow-ups and menu actions. */
export interface GridActions extends AssetMenuActions {
  /** Activate (double-click / Open) an asset — e.g. open a bundle for editing. */
  readonly onActivate?: (asset: BrowserAsset) => void;
}

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
  const r = widgets.assetCard({
    id: asset.guid,
    name: asset.name,
    type: asset.type,
    meta: isChild ? undefined : asset.meta,
    tile,
    thumbnail,
    selected: state.selected === asset.guid,
    checked: st.multiSelect.has(asset.guid),
    subCount,
    expanded: st.expandedAssets.has(asset.guid),
    onContextMenu: () => widgets.contextMenu(asset.guid, buildAssetMenu(asset, isChild, actions)),
  });
  if (r.expandToggled) {
    if (st.expandedAssets.has(asset.guid)) st.expandedAssets.delete(asset.guid);
    else st.expandedAssets.add(asset.guid);
  } else if (r.checkToggled) {
    if (st.multiSelect.has(asset.guid)) st.multiSelect.delete(asset.guid);
    else st.multiSelect.add(asset.guid);
  } else if (r.clicked) {
    state.selected = asset.guid;
    actions.onActivate?.(asset);
  } else if (r.rightClicked) {
    state.selected = asset.guid;
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
 * its children below it.
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
  if (items.length === 0) {
    ui.dummy([0, 18]);
    const msg = st.search.trim() === '' ? 'No assets in this folder.' : `No assets match "${st.search.trim()}".`;
    ui.textDisabled(`   ${msg}`);
    return;
  }

  const list = st.zoom === 'list';
  const tile = list ? 28 : tileFor(st.zoom);

  if (list) {
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
