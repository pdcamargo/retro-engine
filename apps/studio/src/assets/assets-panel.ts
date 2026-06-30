import {
  ASSET_TYPES,
  type AssetType,
  Draw,
  drawIcon,
  type EditorContext,
  type EntityDragPayload,
  getActivePalette,
  type PanelDef,
  srgbU32,
} from '@retro-engine/editor-sdk';

import { createPrefabFromEntity, type RunCommand } from '../dnd-actions';
import type { BrowserAsset } from '../project/project-browser';
import type { ModelSubAssetService } from '../project/model-subassets';
import type { AssetItem } from '../scene-data';
import { type AssetZoom, type StudioState } from '../state';

import { type GridActions, renderAssetsGrid } from './assets-grid';
import { breadcrumbText, renderAssetsTree } from './assets-tree';
import { filterAssetsForPanel, presentTypesForPanel } from './assets-filter';
import { type AssetsPanelState, saveAssetsPrefs } from './assets-panel-state';

const ZOOMS: readonly AssetZoom[] = ['list', 'sm', 'md', 'lg'];
const TREE_W = 148;
const BREADCRUMB_H = 24;

/** Inputs the panel needs beyond editor state: how to resolve model subs + action hooks. */
export interface AssetsPanelDeps {
  /** Lazily enumerates a model's derived children (animations / meshes / materials). */
  readonly subs: ModelSubAssetService;
  /** Activate an asset (e.g. open a bundle for editing). */
  readonly onActivate?: (asset: BrowserAsset) => void;
  /** Invoke an editor command (drag-and-drop authors prefabs through it). */
  readonly runCommand: RunCommand;
}

// With no project open, the mock scene assets stand in — adapted to the browser
// shape (their sprite subs become `sprite`-typed children) so the same grid,
// drawer, and filters drive both paths.
const mockToBrowser = (items: readonly AssetItem[]): BrowserAsset[] =>
  items.map((it) => {
    const asset: BrowserAsset = {
      name: it.name,
      type: it.type,
      guid: it.name,
      location: it.name,
      thumbnailable: false,
      ...(it.meta !== undefined ? { meta: it.meta } : {}),
      ...(it.subs !== undefined
        ? {
            subs: it.subs.map(
              (s): BrowserAsset => ({
                name: s.name,
                type: 'sprite' as AssetType,
                guid: `${it.name}#${s.name}`,
                location: it.name,
                thumbnailable: false,
              }),
            ),
          }
        : {}),
    };
    return asset;
  });

const prefsSignature = (st: AssetsPanelState): string =>
  `${st.zoom}|${st.treeCollapsed ? 1 : 0}|${[...st.typeFilter].sort().join(',')}`;

const renderToolbar = (
  ctx: EditorContext,
  st: AssetsPanelState,
  pool: readonly BrowserAsset[],
  subsOf: (a: BrowserAsset) => readonly BrowserAsset[] | undefined,
): void => {
  const { ui, widgets } = ctx;
  const p = getActivePalette();
  ui.child('assets-toolbar', { size: [0, 40], border: false, padding: [8, 6] }, () => {
    const h = ui.frameHeight();
    // Folder-tree toggle (reclaims the sidebar width for the grid).
    if (widgets.iconButton('assets-tree-toggle', st.treeCollapsed ? 'panel-left-open' : 'panel-left-close')) {
      st.treeCollapsed = !st.treeCollapsed;
    }
    ui.sameLine();
    const avail = ui.contentAvail()[0];
    const RIGHT = 300;
    const it = ui.cursorScreenPos();
    drawIcon('search', [it[0], it[1] + (h - 14) / 2], 14, srgbU32(p.textMuted));
    ui.dummy([18, h]);
    ui.sameLine(0, 4);
    st.search = ui.inputText('##asset-search', st.search, {
      hint: 'Search assets…',
      width: Math.max(120, avail - RIGHT),
    });
    ui.sameLine();
    const label = st.typeFilter.size > 0 ? `Types (${st.typeFilter.size})` : 'Types';
    widgets.dropdown('asset-types', label, 'list-filter', () => {
      if (st.typeFilter.size > 0 && widgets.button('Clear', { variant: 'secondary', size: 'sm' })) {
        st.typeFilter.clear();
      }
      for (const t of presentTypesForPanel(pool, subsOf)) {
        const on = ui.checkbox(`${ASSET_TYPES[t].tag}##tf-${t}`, st.typeFilter.has(t));
        if (on) st.typeFilter.add(t);
        else st.typeFilter.delete(t);
      }
    });
    ui.sameLine();
    // Zoom range bar: list icon — slim track — grid icon, vertically centered.
    const z = ui.cursorScreenPos();
    drawIcon('rows-3', [z[0], z[1] + (h - 14) / 2], 14, srgbU32(p.textMuted));
    ui.dummy([16, h]);
    ui.sameLine(0, 6);
    const zi = widgets.range('asset-zoom', ZOOMS.indexOf(st.zoom), 0, 3, 72);
    st.zoom = ZOOMS[zi] ?? 'md';
    ui.sameLine(0, 6);
    const g = ui.cursorScreenPos();
    drawIcon('grid-2x2', [g[0], g[1] + (h - 14) / 2], 14, srgbU32(p.textMuted));
    ui.dummy([16, h]);
  });
};

/**
 * The Assets panel — the project's asset browser: a folder-tree sidebar, a
 * working toolbar (search, type filter, zoom), and a tile grid whose source
 * files fold open into full-width derived-asset drawers (a model's meshes,
 * materials, and animation clips; a texture's sprites).
 */
export const assetsPanel = (state: StudioState, deps: AssetsPanelDeps): PanelDef => {
  let lastPrefs = '';
  const subsOf = (a: BrowserAsset): readonly BrowserAsset[] | undefined => deps.subs.subsFor(a);
  const actions: GridActions = deps.onActivate !== undefined ? { onActivate: deps.onActivate } : {};

  return {
    id: '/assets',
    title: 'Assets',
    icon: 'folder-open',
    slot: 'bottom',
    flush: true,
    count: () => state.browser?.assets.length ?? state.scene.assets.length,
    render: (ctx: EditorContext): void => {
      const { ui } = ctx;
      const st = state.assets;
      const p = getActivePalette();
      const pool = state.browser !== null ? state.browser.assets : mockToBrowser(state.scene.assets);

      // Dropping an entity onto the panel authors a prefab from its subtree, into
      // the folder currently being browsed. Reused by the header and the empty
      // grid region so the target is reachable whether or not the grid is full.
      const prefabDrop = {
        accepts: (payload: { kind: string }): boolean => payload.kind === 'entity',
        onDrop: (payload: { kind: string }): void =>
          createPrefabFromEntity(deps.runCommand, (payload as EntityDragPayload).entity, st.folder),
      };

      renderToolbar(ctx, st, pool, subsOf);

      // Persist zoom / type filter only when they actually change.
      const sig = prefsSignature(st);
      if (sig !== lastPrefs) {
        lastPrefs = sig;
        saveAssetsPrefs(st);
      }

      const items = filterAssetsForPanel(pool, {
        folder: st.folder,
        typeFilter: st.typeFilter,
        query: st.search,
        subsOf,
      });

      // Two panes that exactly fill the body — no separator and no trailing
      // spacing, so the panel window itself never scrolls (only the tree and the
      // grid scroll, each in its own pane).
      const avail = ui.contentAvail();
      const paneH = avail[1];
      if (!st.treeCollapsed) {
        renderAssetsTree(ctx, st, pool, [TREE_W, paneH]);
        ui.sameLine(0, 6);
      }
      const rightW = st.treeCollapsed ? avail[0] : Math.max(160, avail[0] - TREE_W - 6);

      ui.child('assets-right', { size: [rightW, paneH], border: false, padding: [0, 0] }, () => {
        // Breadcrumb strip on the darker surface.
        const top = ui.cursorScreenPos();
        const w = ui.contentAvail()[0];
        const dl = Draw.window();
        dl.rectFilled([top[0], top[1]], [top[0] + w, top[1] + BREADCRUMB_H], srgbU32(p.gray0));
        drawIcon('folder', [top[0] + 8, top[1] + (BREADCRUMB_H - 13) / 2], 13, srgbU32(p.textFaint));
        dl.text([top[0] + 26, top[1] + (BREADCRUMB_H - 13) / 2], srgbU32(p.text), breadcrumbText(st.folder));
        const count = `${items.length} item${items.length === 1 ? '' : 's'}`;
        dl.text([top[0] + w - ui.calcTextSize(count)[0] - 10, top[1] + (BREADCRUMB_H - 13) / 2], srgbU32(p.textFaint), count);
        // A real hit-target (not a Dummy) so it can receive an entity drop.
        ui.invisibleButton('assets-breadcrumb', [w, BREADCRUMB_H]);
        ui.dropTarget(prefabDrop);

        ui.child('assets-grid', { size: [0, 0], border: false, padding: [10, 8] }, () => {
          renderAssetsGrid(ctx, st, state, state.browser, items, actions);
          // Empty space below the tiles is a prefab-drop zone too (the common aim
          // point when dragging an entity in).
          const rest = ui.contentAvail();
          if (rest[1] > 4) {
            ui.invisibleButton('assets-drop-prefab', [Math.max(rest[0], 1), rest[1]]);
            ui.dropTarget(prefabDrop);
          }
        });
      });
    },
  };
};
