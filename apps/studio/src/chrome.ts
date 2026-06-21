import type { App } from '@retro-engine/engine';
import {
  currentSimState,
  Draw,
  type EditorContext,
  type Editor,
  getActivePalette,
  type History,
  type InspectorRegistry,
  type MenuDef,
  requestSimState,
  type Rgba,
  SimState,
  srgbU32,
  type StatusBarDef,
  type ToolbarDef,
} from '@retro-engine/editor-sdk';

import { type ComposerHooks, entityComposerModal } from './composer/composer-modal';
import { openComposer } from './composer/composer-state';
import { historyClearDialog } from './history-clear-dialog';
import { projectSettingsDialog } from './project-settings';
import { type StudioState, type TransformTool } from './state';
import { enabledSystemCount, systemsFrameMs } from './systems-view';

const rgba = (c: readonly [number, number, number], a = 1): Rgba => [c[0] / 255, c[1] / 255, c[2] / 255, a];

const vsep = (ui: EditorContext['ui']): void => {
  ui.sameLine();
  const p = getActivePalette();
  const at = ui.cursorScreenPos();
  Draw.window().rectFilled([at[0] + 3, at[1] + 2], [at[0] + 4, at[1] + 20], srgbU32(p.gray6));
  ui.dummy([7, 22]);
  ui.sameLine();
};

/** Studio actions the menu bar invokes that live outside the editor state. */
export interface MenuActions {
  /** Prompt for and open a project, re-launching the studio session into it. */
  openProject(): void;
  /** Serialize the open scene and write it back to its source file. */
  saveScene(): void;
  /** Whether there is an open scene that can be saved (a project with a resolved startup scene). */
  canSaveScene(): boolean;
}

/** The menu bar definitions — File / Edit / Entity / Component / Run / Help. */
export const menus = (state: StudioState, history: History, actions: MenuActions): MenuDef[] => [
  {
    id: '/file',
    label: 'File',
    items: () => [
      { label: 'Open Project…', icon: 'folder-open', onClick: () => actions.openProject() },
      { separator: true },
      { label: 'New Scene', icon: 'plus', shortcut: '⌘N' },
      { label: 'Open Scene…', shortcut: '⌘O' },
      { separator: true },
      {
        label: 'Save Scene',
        icon: 'check',
        shortcut: '⌘S',
        disabled: !actions.canSaveScene() || !state.dirty,
        onClick: () => actions.saveScene(),
      },
      { label: 'Save As…', shortcut: '⇧⌘S', disabled: true },
      { separator: true },
      { label: 'Project Settings…', icon: 'settings', onClick: () => (state.settingsOpen = true) },
    ],
  },
  {
    id: '/edit',
    label: 'Edit',
    items: () => [
      { label: 'Undo', shortcut: '⌘Z', disabled: !history.canUndo, onClick: () => history.undo() },
      { label: 'Redo', shortcut: '⇧⌘Z', disabled: !history.canRedo, onClick: () => history.redo() },
      {
        label: 'Clear History',
        icon: 'trash-2',
        disabled: !history.canUndo && !history.canRedo,
        onClick: () => (state.historyClearConfirm = true),
      },
      { separator: true },
      { label: 'Cut', shortcut: '⌘X' },
      { label: 'Copy', shortcut: '⌘C' },
      { label: 'Paste', shortcut: '⌘V' },
    ],
  },
  {
    id: '/entity',
    label: 'Entity',
    items: () => [
      { label: 'Create Empty', icon: 'plus' },
      { label: 'Duplicate', icon: 'copy', shortcut: '⌘D' },
      { separator: true },
      { label: 'Delete', icon: 'trash-2', danger: true, shortcut: '⌫' },
    ],
  },
  {
    id: '/component',
    label: 'Component',
    items: () => [
      {
        label: 'Add Component…',
        icon: 'plus',
        disabled: state.selectedEntity === null,
        onClick: () => openComposer(state.composer, 'add', { target: state.selectedEntity }),
      },
      {
        label: 'New Bundle…',
        icon: 'package',
        onClick: () => openComposer(state.composer, 'bundle'),
      },
    ],
  },
  {
    id: '/run',
    label: 'Run',
    items: () => [
      { label: state.playing ? 'Stop' : 'Play', icon: state.playing ? 'square' : 'play', shortcut: '⌘P' },
      { label: 'Pause', icon: 'pause', disabled: !state.playing },
      { label: 'Step', icon: 'skip-forward', disabled: !state.playing },
    ],
  },
  {
    id: '/help',
    label: 'Help',
    items: () => [
      { label: 'Documentation', icon: 'square-arrow-out-up-right' },
      { label: 'About Retro Engine' },
    ],
  },
];

// Play ↔ Stop. Drives the engine's SimState; `state.playing`/`paused` are mirrors
// synced from it each frame. The transition applies on the next frame.
const togglePlay = (state: StudioState, app: App): void => {
  const sim = currentSimState(app);
  if (sim === SimState.Edit || sim === undefined) {
    requestSimState(app, SimState.Play);
    state.scene.console.push({
      time: '12:05:01',
      lvl: 'cmd',
      text: `entering play mode — ${enabledSystemCount(app)} systems running`,
    });
  } else {
    requestSimState(app, SimState.Edit);
  }
};

// Pause ↔ resume, only meaningful while in play mode.
const togglePause = (app: App): void => {
  const sim = currentSimState(app);
  if (sim === SimState.Play) requestSimState(app, SimState.Paused);
  else if (sim === SimState.Paused) requestSimState(app, SimState.Play);
};

const BTN = 26;
const TOOL_GAP = 3;

// Draw a bordered well (gray-0 fill + 1px border) behind `count` sm buttons that
// start at the current cursor; returns nothing (buttons render on top).
const groupWell = (ui: EditorContext['ui'], count: number): void => {
  const p = getActivePalette();
  const a = ui.cursorScreenPos();
  const w = count * BTN + (count - 1) * TOOL_GAP + 6;
  const dl = Draw.window();
  dl.rectFilled([a[0] - 3, a[1] - 3], [a[0] + w - 3, a[1] + BTN + 3], srgbU32(p.gray0), 4);
  dl.rect([a[0] - 3, a[1] - 3], [a[0] + w - 3, a[1] + BTN + 3], srgbU32(p.gray6), 4);
};

/** The toolbar: transform tools, snap/gizmo toggles, profiler, the play group, layout/settings. */
export const toolbar = (state: StudioState, editor: Editor, app: App): ToolbarDef => ({
  render: ({ ui, widgets }: EditorContext, width: number): void => {
    const tools: {
      tool: TransformTool;
      icon: 'mouse-pointer-2' | 'move' | 'rotate-3d' | 'scaling' | 'axis-3d';
      tip: string;
    }[] = [
      { tool: 'select', icon: 'mouse-pointer-2', tip: 'Select (Q)' },
      { tool: 'move', icon: 'move', tip: 'Move (W)' },
      { tool: 'rotate', icon: 'rotate-3d', tip: 'Rotate (E)' },
      { tool: 'scale', icon: 'scaling', tip: 'Scale (R)' },
      { tool: 'all', icon: 'axis-3d', tip: 'Transform — move/rotate/scale (T)' },
    ];
    groupWell(ui, tools.length);
    for (const [i, t] of tools.entries()) {
      if (i > 0) ui.sameLine(0, TOOL_GAP);
      if (widgets.iconButton(`tool-${t.tool}`, t.icon, { active: state.tool === t.tool, tooltip: t.tip, size: 'sm' })) {
        state.tool = t.tool;
      }
    }
    vsep(ui);
    // Scene viewport projection: orthographic 2D or perspective 3D.
    groupWell(ui, 2);
    if (widgets.iconButton('view-3d', 'box', { active: state.viewMode === '3d', tooltip: '3D view (3)', size: 'sm' })) {
      state.viewMode = '3d';
    }
    ui.sameLine(0, TOOL_GAP);
    if (widgets.iconButton('view-2d', 'grid-2x2', { active: state.viewMode === '2d', tooltip: '2D view (2)', size: 'sm' })) {
      state.viewMode = '2d';
    }
    vsep(ui);
    if (widgets.iconButton('snap', 'grid-3x3', { active: state.snap, tooltip: 'Snap to grid', size: 'sm' })) {
      state.snap = !state.snap;
    }
    ui.sameLine(0, TOOL_GAP);
    if (widgets.iconButton('gizmos', 'axis-3d', { active: state.gizmos, tooltip: 'Toggle gizmos', size: 'sm' })) {
      state.gizmos = !state.gizmos;
    }
    vsep(ui);
    if (widgets.iconButton('profiler', 'gauge', { active: state.showProfiler, tooltip: 'Profiler', size: 'sm' })) {
      state.showProfiler = !state.showProfiler;
      editor.setPanelOpen('/profiler', state.showProfiler);
    }

    // Center: play group, in its own well.
    const playW = 3 * BTN + 2 * TOOL_GAP + 6;
    ui.sameLine();
    ui.setCursorPosX(width / 2 - playW / 2);
    groupWell(ui, 3);
    if (state.playing) {
      if (widgets.iconButton('play', 'square', { active: true, tooltip: 'Stop', size: 'sm' })) togglePlay(state, app);
    } else if (widgets.iconButton('play', 'play', { tooltip: 'Play', size: 'sm' })) {
      togglePlay(state, app);
    }
    ui.sameLine(0, TOOL_GAP);
    if (widgets.iconButton('pause', 'pause', { active: state.paused, tooltip: 'Pause', size: 'sm' }) && state.playing) {
      togglePause(app);
    }
    ui.sameLine(0, TOOL_GAP);
    widgets.iconButton('step', 'skip-forward', { tooltip: 'Step', size: 'sm' });

    // Right: layout + settings.
    ui.sameLine();
    ui.setCursorPosX(width - 2 * BTN - TOOL_GAP);
    widgets.iconButton('layout', 'layout-dashboard', { tooltip: 'Layout', size: 'sm' });
    ui.sameLine(0, TOOL_GAP);
    if (widgets.iconButton('settings', 'settings', { tooltip: 'Project settings', size: 'sm' })) {
      state.settingsOpen = true;
    }
  },
});

/** The status bar: readiness, counts, and toolchain info. */
export const statusBar = (state: StudioState, app: App): StatusBarDef => ({
  render: ({ ui }: EditorContext, width: number): void => {
    const p = getActivePalette();
    const muted = rgba(p.textFaint);
    const seg = (icon: Parameters<typeof ui.icon>[0], text: string, color: Rgba): void => {
      ui.icon(icon, color);
      ui.sameLine(0);
      ui.textColored(color, ` ${text}`);
      ui.sameLine();
      ui.dummy([10, 0]);
      ui.sameLine();
    };
    const n = state.scene.entities.filter((e) => e.group !== true).length;
    if (state.dirty) seg('circle-dot', 'Unsaved', rgba(p.amber400));
    else seg('circle-check', 'Ready', rgba(p.green400));
    seg('box', `${n} entities`, muted);
    seg('workflow', `${enabledSystemCount(app)} systems`, muted);
    seg('cpu', `${systemsFrameMs(app).toFixed(1)} ms/frame`, muted);
    // Right side, measured so it ends flush with the right edge.
    const ts = 'TypeScript 5.6';
    const hot = ' Hot reload on';
    const rightW = ui.calcTextSize(ts)[0] + 14 + 16 + ui.calcTextSize(hot)[0];
    ui.sameLine();
    ui.setCursorPosX(Math.max(ui.cursorPosX(), width - rightW));
    ui.textColored(muted, ts);
    ui.sameLine();
    ui.dummy([8, 0]);
    ui.sameLine();
    ui.icon('zap', rgba(p.green400));
    ui.sameLine(0);
    ui.textColored(muted, hot);
  },
});

/** Draw the studio's modal dialogs + popups (call once per frame after the shell). */
export const drawDialogs = (
  ctx: EditorContext,
  state: StudioState,
  history: History,
  app: App,
  composer: { readonly inspector: InspectorRegistry; readonly hooks: ComposerHooks },
): void => {
  projectSettingsDialog(ctx, state);
  historyClearDialog(ctx, state, history);
  entityComposerModal(ctx, state.composer, app, history, composer.inspector, composer.hooks);
};
