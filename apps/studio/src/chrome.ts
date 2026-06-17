import {
  Draw,
  type EditorContext,
  type Editor,
  getActivePalette,
  type History,
  type MenuDef,
  type Rgba,
  srgbU32,
  type StatusBarDef,
  type ToolbarDef,
} from '@retro-engine/editor-sdk';

import { projectSettingsDialog } from './project-settings';
import { enabledSystems, frameMs, type StudioState, type TransformTool } from './state';

const rgba = (c: readonly [number, number, number], a = 1): Rgba => [c[0] / 255, c[1] / 255, c[2] / 255, a];

const vsep = (ui: EditorContext['ui']): void => {
  ui.sameLine();
  const p = getActivePalette();
  const at = ui.cursorScreenPos();
  Draw.window().rectFilled([at[0] + 3, at[1] + 2], [at[0] + 4, at[1] + 20], srgbU32(p.gray6));
  ui.dummy([7, 22]);
  ui.sameLine();
};

/** The menu bar definitions — File / Edit / Entity / Component / Run / Help. */
export const menus = (state: StudioState, history: History): MenuDef[] => [
  {
    id: '/file',
    label: 'File',
    items: () => [
      { label: 'New Scene', icon: 'plus', shortcut: '⌘N' },
      { label: 'Open Scene…', icon: 'folder-open', shortcut: '⌘O' },
      { separator: true },
      { label: 'Save', icon: 'check', shortcut: '⌘S' },
      { label: 'Save As…', shortcut: '⇧⌘S' },
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
      { heading: 'Add Component' },
      { label: 'Transform', icon: 'move-3d' },
      { label: 'Sprite', icon: 'image' },
      { label: 'RigidBody', icon: 'circle-dot' },
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

const togglePlay = (state: StudioState): void => {
  state.playing = !state.playing;
  if (state.playing) {
    state.scene.console.push({
      time: '12:05:01',
      lvl: 'cmd',
      text: `entering play mode — ${enabledSystems(state)} systems running`,
    });
  } else {
    state.paused = false;
  }
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
export const toolbar = (state: StudioState, editor: Editor): ToolbarDef => ({
  render: ({ ui, widgets }: EditorContext, width: number): void => {
    const tools: { tool: TransformTool; icon: 'mouse-pointer-2' | 'move' | 'rotate-3d' | 'scaling'; tip: string }[] = [
      { tool: 'select', icon: 'mouse-pointer-2', tip: 'Select (Q)' },
      { tool: 'move', icon: 'move', tip: 'Move (W)' },
      { tool: 'rotate', icon: 'rotate-3d', tip: 'Rotate (E)' },
      { tool: 'scale', icon: 'scaling', tip: 'Scale (R)' },
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
      if (widgets.iconButton('play', 'square', { active: true, tooltip: 'Stop', size: 'sm' })) togglePlay(state);
    } else if (widgets.iconButton('play', 'play', { tooltip: 'Play', size: 'sm' })) {
      togglePlay(state);
    }
    ui.sameLine(0, TOOL_GAP);
    widgets.iconButton('pause', 'pause', { active: state.paused, tooltip: 'Pause', size: 'sm' });
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
export const statusBar = (state: StudioState): StatusBarDef => ({
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
    seg('circle-check', 'Ready', rgba(p.green400));
    seg('box', `${n} entities`, muted);
    seg('workflow', `${enabledSystems(state)} systems`, muted);
    seg('cpu', `${frameMs(state).toFixed(1)} ms/frame`, muted);
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

/** Draw the Project Settings modal (call once per frame after the shell). */
export const drawDialogs = (ctx: EditorContext, state: StudioState): void => {
  projectSettingsDialog(ctx, state);
};
