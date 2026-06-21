import { ImGui, ImGuiKey } from '@mori2003/jsimgui';
import type { History } from '@retro-engine/editor-sdk';

import { type SceneCameraController } from './editor-camera';
import { type StudioState, type TransformTool } from './state';

/**
 * The editor's keyboard scheme, in one place so it stays discoverable (a help
 * popup or the toolbar tooltips can render this table) rather than scattered
 * across `IsKeyPressed` calls. The discrete shortcuts are dispatched by
 * {@link handleShortcuts}; the hold-to-navigate bindings are handled by
 * {@link SceneCameraController} and listed here only for documentation.
 */
export const EDITOR_SHORTCUTS: ReadonlyArray<{ group: string; items: ReadonlyArray<{ keys: string; label: string }> }> = [
  {
    group: 'Viewport',
    items: [
      { keys: '2', label: '2D (orthographic) view' },
      { keys: '3', label: '3D (perspective) view' },
      { keys: 'F', label: 'Frame scene' },
    ],
  },
  {
    group: 'Edit',
    items: [
      { keys: '⌘Z', label: 'Undo' },
      { keys: '⌘Y / ⇧⌘Z', label: 'Redo' },
    ],
  },
  {
    group: 'Tools',
    items: [
      { keys: 'Q', label: 'Select' },
      { keys: 'W', label: 'Move' },
      { keys: 'E', label: 'Rotate' },
      { keys: 'R', label: 'Scale' },
      { keys: 'T', label: 'Transform (all)' },
    ],
  },
  {
    group: 'Navigate (hold)',
    items: [
      { keys: 'RMB', label: '3D look · WASD/QE fly · Shift faster' },
      { keys: 'MMB', label: 'Pan (or Space + LMB)' },
      { keys: 'Wheel', label: '3D dolly · 2D zoom' },
      { keys: 'Alt + LMB', label: '3D orbit' },
    ],
  },
];

const TOOL_KEYS: ReadonlyArray<{ key: ImGuiKey; tool: TransformTool }> = [
  { key: ImGuiKey._Q, tool: 'select' },
  { key: ImGuiKey._W, tool: 'move' },
  { key: ImGuiKey._E, tool: 'rotate' },
  { key: ImGuiKey._R, tool: 'scale' },
  { key: ImGuiKey._T, tool: 'all' },
];

/**
 * Dispatch the discrete editor shortcuts for this frame. Call from the Scene
 * panel body (where ImGui key state is live), passing whether the viewport is
 * hovered.
 *
 * Shortcuts fire only while the viewport is hovered and no navigation drag is
 * active — so the WASD/QE fly keys can't double as the move/rotate tool keys
 * mid-flight, and typing elsewhere never triggers them.
 */
export const handleShortcuts = (
  state: StudioState,
  controller: SceneCameraController,
  hovered: boolean,
): void => {
  if (!hovered || controller.navigating) return;
  const pressed = (k: ImGuiKey): boolean => ImGui.IsKeyPressed(k, false);

  if (pressed(ImGuiKey._2)) state.viewMode = '2d';
  if (pressed(ImGuiKey._3)) state.viewMode = '3d';
  if (pressed(ImGuiKey._F)) controller.frame();
  for (const { key, tool } of TOOL_KEYS) {
    if (pressed(key)) state.tool = tool;
  }
};

/**
 * Dispatch undo/redo for this frame: `Ctrl+Z` undoes, `Ctrl+Y` or `Ctrl+Shift+Z`
 * redoes. App-wide (not gated on viewport hover), but skipped while a text field
 * is active so in-field editing keeps its own undo. Call once per frame from the
 * UI draw callback, where key state is live.
 */
export const handleHistoryShortcuts = (history: History): void => {
  if (ImGui.GetIO().WantTextInput) return;
  const ctrl = ImGuiKey.ImGuiMod_Ctrl;
  const shift = ImGuiKey.ImGuiMod_Shift;
  if (ImGui.IsKeyChordPressed(ctrl | ImGuiKey._Z)) {
    if (history.canUndo) history.undo();
    return;
  }
  if (ImGui.IsKeyChordPressed(ctrl | ImGuiKey._Y) || ImGui.IsKeyChordPressed(ctrl | shift | ImGuiKey._Z)) {
    if (history.canRedo) history.redo();
  }
};

/**
 * Dispatch Save (`Ctrl/⌘+S`) for this frame. Fires only when `canSave` is true (a
 * saveable scene with unsaved edits), so an idle ⌘S is a no-op. Call once per
 * frame from the UI draw callback, where key state is live.
 */
export const handleSaveShortcut = (canSave: boolean, save: () => void): void => {
  if (!canSave) return;
  if (ImGui.IsKeyChordPressed(ImGuiKey.ImGuiMod_Ctrl | ImGuiKey._S)) save();
};
