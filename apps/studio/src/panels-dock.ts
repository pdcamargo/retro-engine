import type { App, SystemInfo, SystemOrigin } from '@retro-engine/engine';
import {
  currentSimState,
  Draw,
  type EditorContext,
  getActivePalette,
  type IconName,
  type PanelDef,
  type Rgba,
  SimState,
  srgbU32,
  type Tone,
} from '@retro-engine/editor-sdk';

import { type ConsoleLevel } from './scene-data';
import { type StudioState } from './state';
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
