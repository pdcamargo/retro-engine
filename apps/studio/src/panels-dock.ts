import {
  Draw,
  drawIcon,
  type EditorContext,
  getActivePalette,
  type PanelDef,
  type Rgba,
  srgbU32,
  type Widgets,
} from '@retro-engine/editor-sdk';

import { type AssetItem, type ConsoleLevel, type SystemRow } from './scene-data';
import { type AssetZoom, enabledSystems, frameMs, type StudioState, tileFor } from './state';

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

const stageTone = (stage: string): 'info' | 'warning' | 'accent' =>
  stage === 'Render' ? 'accent' : stage === 'FixedUpdate' ? 'warning' : 'info';

/** The Systems panel — a profiler-style data table. */
export const systemsPanel = (state: StudioState): PanelDef => ({
  id: '/systems',
  title: 'Systems',
  icon: 'workflow',
  slot: 'bottom',
  count: () => enabledSystems(state),
  render: ({ ui, widgets }: EditorContext): void => {
    widgets.dataTable<SystemRow>({
      id: 'systems',
      rows: state.scene.systems,
      rowBg: true,
      borders: 'h',
      dense: true,
      columns: [
        {
          key: 'on',
          label: '',
          width: 28,
          render: (row) => {
            row.on = ui.checkbox(`##sys-${row.name}`, row.on);
          },
        },
        {
          key: 'name',
          label: 'System',
          render: (row) => {
            if (row.on) ui.text(row.name);
            else ui.textDisabled(row.name);
          },
        },
        {
          key: 'stage',
          label: 'Stage',
          width: 110,
          render: (row) => widgets.badge(row.stage.toUpperCase(), { tone: stageTone(row.stage) }),
        },
        {
          key: 'ms',
          label: 'ms/frame',
          width: 80,
          right: true,
          render: (row) => {
            const text = row.ms.toFixed(2);
            ui.rightAlign(ui.calcTextSize(text)[0]);
            if (row.on) ui.text(text);
            else ui.textDisabled(text);
          },
        },
      ],
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

/** The Assets panel — a zoomable, filterable tile grid with sprite-sheet drawers. */
export const assetsPanel = (state: StudioState): PanelDef => ({
  id: '/assets',
  title: 'Assets',
  icon: 'folder-open',
  slot: 'bottom',
  flush: true,
  count: () => state.scene.assets.length,
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
    const assets = state.scene.assets.filter((a) => filter === '' || a.name.toLowerCase().includes(filter));
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

/** The floating Profiler window — a bar per system, scaled to the slowest. */
export const profilerPanel = (state: StudioState): PanelDef => ({
  id: '/profiler',
  title: 'Profiler',
  icon: 'gauge',
  slot: 'float',
  closable: true,
  hidden: true,
  render: ({ ui }: EditorContext): void => {
    const p = getActivePalette();
    const systems = state.scene.systems;
    const maxMs = Math.max(...systems.map((s) => s.ms), 0.01);
    for (const sys of systems) {
      ui.withId(`prof-${sys.name}`, () => {
        const dim = sys.on ? 1 : 0.4;
        ui.textColored(rgba(p.textMuted, dim), sys.name.slice(0, 16));
        ui.sameLine(118);
        const w = ui.contentAvail()[0] - 48;
        const h = 10;
        const start = ui.cursorScreenPos();
        const dl = Draw.window();
        dl.rectFilled([start[0], start[1] + 4], [start[0] + w, start[1] + 4 + h], srgbU32(p.gray4, dim), 2);
        const fillW = (sys.ms / maxMs) * w;
        dl.rectFilled([start[0], start[1] + 4], [start[0] + fillW, start[1] + 4 + h], srgbU32(p.green600, dim), 2);
        ui.dummy([w, h + 4]);
        ui.sameLine();
        ui.textColored(rgba(p.text, dim), sys.ms.toFixed(2));
      });
    }
    ui.separator();
    ui.textColored(rgba(p.green400), frameMs(state).toFixed(2));
    ui.sameLine();
    ui.textDisabled(`ms/frame · ${systems.length} systems`);
  },
});
