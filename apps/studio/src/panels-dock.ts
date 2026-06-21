import type { App, SystemInfo, SystemOrigin } from '@retro-engine/engine';
import {
  currentSimState,
  Draw,
  drawIcon,
  type EditorContext,
  getActivePalette,
  type IconName,
  type PanelDef,
  type Rgba,
  SimState,
  srgbU32,
  type Tone,
  type Widgets,
} from '@retro-engine/editor-sdk';

import type { BrowserAsset, ProjectBrowser } from './project/project-browser';
import { type AssetItem, type ConsoleLevel } from './scene-data';
import { type AssetZoom, type StudioState, tileFor } from './state';
import { enabledSystemCount, flattenSystems, groupSystems, pluginLabel, systemsFrameMs } from './systems-view';

const rgba = (c: readonly [number, number, number], a = 1): Rgba => [c[0] / 255, c[1] / 255, c[2] / 255, a];

const levelColor = (lvl: ConsoleLevel): Rgba => {
  const p = getActivePalette();
  switch (lvl) {
    case 'cmd':
      return rgba(p.green400);
    case 'warn':
      return rgba(p.amber400);
    case 'err':
      return rgba(p.red400);
    case 'info':
    default:
      return rgba(p.textMuted);
  }
};

/** The Console panel — compiler-style log lines. */
export const consolePanel = (state: StudioState): PanelDef => ({
  id: '/console',
  title: 'Console',
  icon: 'terminal',
  slot: 'bottom',
  flush: true,
  count: () => state.scene.console.length,
  render: ({ ui }: EditorContext): void => {
    ui.child('console-body', { size: [0, 0], border: false, padding: [8, 6] }, () => {
      for (const [i, line] of state.scene.console.entries()) {
        ui.withId(`line-${i}`, () => {
          ui.textColored(rgba(getActivePalette().textFaint), line.time);
          ui.sameLine(64);
          ui.textColored(levelColor(line.lvl), line.lvl === 'cmd' ? `▸ ${line.text}` : line.text);
          if (line.meta !== undefined) {
            ui.sameLine();
            ui.textDisabled(line.meta);
          }
        });
      }
    });
  },
});

// Engine stages map onto three visual tones: render (accent), the fixed-timestep
// stages (warning), and everything in the main schedule (info).
const stageTone = (stage: string): Tone =>
  stage === 'render' ? 'accent' : stage.startsWith('fixed') ? 'warning' : 'info';

const categoryIcon = (origin: SystemOrigin): IconName =>
  origin === 'engine' ? 'box' : origin === 'editor' ? 'wrench' : 'user';

const simTone = (sim: SimState | undefined): Tone =>
  sim === SimState.Play ? 'success' : sim === SimState.Paused ? 'warning' : 'neutral';

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The Systems panel — the live engine schedule, bucketed Engine / Editor / User
 * and (within a bucket) kept plugin-contiguous. Toggling a row enables or
 * disables that system in the running App; the ms column is the rolling
 * per-system cost from the profiler.
 */
export const systemsPanel = (app: App): PanelDef => ({
  id: '/systems',
  title: 'Systems',
  icon: 'workflow',
  slot: 'bottom',
  flush: true,
  count: () => enabledSystemCount(app),
  render: ({ ui, widgets }: EditorContext): void => {
    const p = getActivePalette();
    ui.child('systems-body', { size: [0, 0], border: false, padding: [8, 6] }, () => {
      const sim = currentSimState(app);
      ui.textColored(rgba(p.textFaint), 'MODE');
      ui.sameLine();
      widgets.badge((sim?.name ?? 'Edit').toUpperCase(), { tone: simTone(sim) });
      ui.sameLine();
      ui.textDisabled('· User systems run in Play');
      ui.separator();

      for (const cat of groupSystems(app)) {
        if (cat.total === 0) continue;
        const open = widgets.collapsingHeader(`sys-cat-${cat.origin}`, {
          title: `${cat.label}    ${cat.enabled}/${cat.total}`,
          icon: categoryIcon(cat.origin),
          defaultOpen: true,
        });
        if (!open) continue;
        widgets.dataTable<SystemInfo>({
          id: `sys-${cat.origin}`,
          rows: cat.systems,
          rowBg: true,
          borders: 'h',
          dense: true,
          columns: [
            {
              key: 'on',
              label: '',
              width: 28,
              render: (row) => {
                const on = ui.checkbox(`##sys-${row.id}`, row.enabled);
                if (on !== row.enabled) app.setSystemEnabled(row.id, on);
              },
            },
            {
              key: 'name',
              label: 'System',
              render: (row) => {
                if (row.enabled) ui.text(row.name);
                else ui.textDisabled(row.name);
              },
            },
            {
              key: 'plugin',
              label: 'Plugin',
              width: 150,
              render: (row) => ui.textDisabled(truncate(pluginLabel(row), 20)),
            },
            {
              key: 'stage',
              label: 'Stage',
              width: 96,
              render: (row) => widgets.badge(row.stage.toUpperCase(), { tone: stageTone(row.stage) }),
            },
            {
              key: 'ms',
              label: 'ms/frame',
              width: 72,
              right: true,
              render: (row) => {
                const text = row.avgMs !== undefined ? row.avgMs.toFixed(2) : '—';
                ui.rightAlign(ui.calcTextSize(text)[0]);
                if (row.enabled) ui.text(text);
                else ui.textDisabled(text);
              },
            },
          ],
        });
      }
    });
  },
});

const renderAssetCard = (widgets: Widgets, state: StudioState, asset: AssetItem, tile: number): void => {
  const r = widgets.assetCard({
    id: asset.name,
    name: asset.name,
    type: asset.type,
    meta: asset.meta,
    tile,
    selected: state.selected === asset.name,
    error: asset.error,
    subCount: asset.subs?.length,
    expanded: asset.expanded,
  });
  if (r.expandToggled) asset.expanded = asset.expanded !== true;
  else if (r.clicked) state.selected = asset.name;
};

// A live project asset tile: paints the generated thumbnail once ready (image
// assets), otherwise the widget's procedural preview for the type.
const renderBrowserCard = (
  widgets: Widgets,
  browser: ProjectBrowser,
  state: StudioState,
  asset: BrowserAsset,
  tile: number,
  onActivate?: (asset: BrowserAsset) => void,
): void => {
  const thumbnail = asset.thumbnailable ? browser.thumbnails.get(asset.guid, asset.location) : undefined;
  const r = widgets.assetCard({
    id: asset.guid,
    name: asset.name,
    type: asset.type,
    meta: asset.meta,
    tile,
    selected: state.selected === asset.guid,
    thumbnail,
  });
  if (r.clicked) {
    state.selected = asset.guid;
    if (asset.type === 'bundle') onActivate?.(asset);
  }
};

// Lay out asset tiles in a wrapping grid (or a single column in list mode).
const layoutGrid = <T>(
  ui: EditorContext['ui'],
  zoom: AssetZoom,
  items: readonly T[],
  draw: (item: T, tile: number) => void,
): void => {
  if (zoom === 'list') {
    for (const item of items) draw(item, 28);
    return;
  }
  const tile = tileFor(zoom);
  const gap = 14;
  const cols = Math.max(1, Math.floor((ui.contentAvail()[0] + gap) / (tile + gap)));
  let col = 0;
  for (const item of items) {
    if (col > 0) ui.sameLine();
    draw(item, tile);
    col = (col + 1) % cols;
  }
};

/** The Assets panel — a zoomable, filterable tile grid with sprite-sheet drawers. */
export const assetsPanel = (state: StudioState, onActivate?: (asset: BrowserAsset) => void): PanelDef => ({
  id: '/assets',
  title: 'Assets',
  icon: 'folder-open',
  slot: 'bottom',
  flush: true,
  count: () => state.browser?.assets.length ?? state.scene.assets.length,
  render: ({ ui, widgets }: EditorContext): void => {
    // Sticky toolbar: search, Types dropdown, and the zoom range bar (list → lg).
    const zooms: AssetZoom[] = ['list', 'sm', 'md', 'lg'];
    ui.child('assets-toolbar', { size: [0, 40], border: false, padding: [8, 6] }, () => {
      const p = getActivePalette();
      const h = ui.frameHeight();
      const avail = ui.contentAvail()[0];
      // Reserve room for the right-hand controls (Types dropdown + zoom bar).
      const RIGHT = 270;
      const it = ui.cursorScreenPos();
      drawIcon('search', [it[0], it[1] + (h - 14) / 2], 14, srgbU32(p.textMuted));
      ui.dummy([18, h]);
      ui.sameLine(0, 4);
      state.assetSearch = ui.inputText('##asset-search', state.assetSearch, {
        hint: 'Search assets…',
        width: Math.max(120, avail - RIGHT),
      });
      ui.sameLine();
      widgets.dropdown('asset-types', 'Types', 'list-filter', () => {
        for (const t of ['Textures', 'Materials', 'Meshes', 'Scenes', 'Scripts', 'Audio']) {
          ui.checkbox(t, true);
        }
      });
      ui.sameLine();
      // Zoom range bar: list icon — slim track — grid icon, all vertically centered.
      const z = ui.cursorScreenPos();
      drawIcon('rows-3', [z[0], z[1] + (h - 14) / 2], 14, srgbU32(p.textMuted));
      ui.dummy([16, h]);
      ui.sameLine(0, 6);
      const zi = widgets.range('asset-zoom', zooms.indexOf(state.assetZoom), 0, 3, 72);
      state.assetZoom = zooms[zi] ?? 'md';
      ui.sameLine(0, 6);
      const g = ui.cursorScreenPos();
      drawIcon('grid-2x2', [g[0], g[1] + (h - 14) / 2], 14, srgbU32(p.textMuted));
      ui.dummy([16, h]);
    });
    ui.separator();

    const filter = state.assetSearch.trim().toLowerCase();
    const matches = (name: string): boolean => filter === '' || name.toLowerCase().includes(filter);

    // Live project browser: real project assets with generated thumbnails.
    const browser = state.browser;
    if (browser !== null) {
      const assets = browser.assets.filter((a) => matches(a.name));
      ui.child('assets-grid', { size: [0, 0], border: false, padding: [10, 10] }, () => {
        layoutGrid(ui, state.assetZoom, assets, (asset, tile) =>
          renderBrowserCard(widgets, browser, state, asset, tile, onActivate),
        );
      });
      return;
    }

    const assets = state.scene.assets.filter((a) => matches(a.name));
    ui.child('assets-grid', { size: [0, 0], border: false, padding: [10, 10] }, () => {
      if (state.assetZoom === 'list') {
        for (const asset of assets) renderAssetCard(widgets, state, asset, 28);
        return;
      }
      const tile = tileFor(state.assetZoom);
      const gap = 14;
      const cols = Math.max(1, Math.floor((ui.contentAvail()[0] + gap) / (tile + gap)));
      let col = 0;
      for (const asset of assets) {
        if (asset.subs !== undefined && asset.expanded === true) {
          col = 0;
          widgets.assetGroup({
            id: asset.name,
            name: asset.name,
            meta: asset.meta,
            subCount: asset.subs.length,
            tile,
            onCollapse: () => {
              asset.expanded = false;
            },
            body: () => {
              let c = 0;
              for (const sub of asset.subs ?? []) {
                if (c > 0) ui.sameLine();
                widgets.assetCard({ id: `${asset.name}-${sub.name}`, name: sub.name, type: 'sprite', tile });
                c = (c + 1) % cols;
              }
            },
          });
          continue;
        }
        if (col > 0) ui.sameLine();
        renderAssetCard(widgets, state, asset, tile);
        col = (col + 1) % cols;
      }
    });
  },
});

/** The floating Profiler window — a bar per system, scaled to the slowest, from the live profiler. */
export const profilerPanel = (app: App): PanelDef => ({
  id: '/profiler',
  title: 'Profiler',
  icon: 'gauge',
  slot: 'float',
  closable: true,
  hidden: true,
  render: ({ ui }: EditorContext): void => {
    const p = getActivePalette();
    // The slowest systems first — the profiler is for finding cost, not browsing.
    const systems = flattenSystems(app)
      .filter((s) => (s.avgMs ?? 0) > 0)
      .sort((a, b) => (b.avgMs ?? 0) - (a.avgMs ?? 0));
    const maxMs = Math.max(...systems.map((s) => s.avgMs ?? 0), 0.01);
    for (const sys of systems) {
      ui.withId(`prof-${sys.id}`, () => {
        const ms = sys.avgMs ?? 0;
        const dim = sys.enabled ? 1 : 0.4;
        ui.textColored(rgba(p.textMuted, dim), sys.name.slice(0, 16));
        ui.sameLine(118);
        const w = ui.contentAvail()[0] - 48;
        const h = 10;
        const start = ui.cursorScreenPos();
        const dl = Draw.window();
        dl.rectFilled([start[0], start[1] + 4], [start[0] + w, start[1] + 4 + h], srgbU32(p.gray4, dim), 2);
        const fillW = (ms / maxMs) * w;
        dl.rectFilled([start[0], start[1] + 4], [start[0] + fillW, start[1] + 4 + h], srgbU32(p.green600, dim), 2);
        ui.dummy([w, h + 4]);
        ui.sameLine();
        ui.textColored(rgba(p.text, dim), ms.toFixed(2));
      });
    }
    ui.separator();
    ui.textColored(rgba(p.green400), systemsFrameMs(app).toFixed(2));
    ui.sameLine();
    ui.textDisabled(`ms/frame · ${systems.length} systems`);
  },
});
