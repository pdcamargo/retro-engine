import { ImGui, ImVec2 } from '@mori2003/jsimgui';
import {
  Draw,
  type EditorContext,
  drawIcon,
  getActivePalette,
  type IconName,
  packU32,
  type PanelDef,
  srgbU32,
  type Vec2,
} from '@retro-engine/editor-sdk';

import { type SceneCameraController } from './editor-camera';
import { type SceneGizmos } from './gizmo-wiring';
import { type ScenePicker } from './scene-picker';
import { handleShortcuts } from './shortcuts';
import { type StudioState } from './state';
import { type SceneOrientationGizmo } from './viewport-gizmo-wiring';
import { type ViewportTarget } from './viewport';

const CHIP_H = 19;
const CHIP_FS = 11; // compact chip text so all chips fit a narrow viewport

// Chip width from a fixed per-glyph estimate (mono UI font at CHIP_FS).
const chipWidth = (icon: IconName | null, text: string): number =>
  text.length * CHIP_FS * 0.6 + 12 + (icon !== null ? 14 : 0);

const chip = (
  dl: Draw,
  ui: EditorContext['ui'],
  pos: Vec2,
  icon: IconName | null,
  text: string,
  fg: number,
): number => {
  const iconW = icon !== null ? 14 : 0;
  const w = chipWidth(icon, text);
  dl.rectFilled(pos, [pos[0] + w, pos[1] + CHIP_H], packU32(7, 11, 10, 200), 3);
  dl.rect(pos, [pos[0] + w, pos[1] + CHIP_H], packU32(45, 60, 65, 220), 3);
  if (icon !== null) drawIcon(icon, [pos[0] + 4, pos[1] + (CHIP_H - 12) / 2], 12, fg);
  ui.withFont('ui', CHIP_FS, () => dl.text([pos[0] + 6 + iconW, pos[1] + (CHIP_H - CHIP_FS) / 2 - 1], fg, text));
  return w + 6;
};

/**
 * Size the viewport to its panel, draw the live render, and record the panel's
 * visibility + local cursor (for a future ray-pick). Returns the panel's screen
 * rect `[min, max]` so callers can overlay chrome on top of the image.
 */
const drawViewport = (
  ui: EditorContext['ui'],
  view: ViewportTarget,
): { min: Vec2; max: Vec2; iw: number; ih: number; hovered: boolean } => {
  const min = ui.cursorScreenPos();
  const [w, h] = ui.contentAvail();
  const iw = Math.max(1, Math.floor(w));
  const ih = Math.max(1, Math.floor(h));
  view.ensureSize(iw, ih);
  view.visibleThisFrame = true;
  view.localMouse = ui.windowMousePos();
  let hovered = false;
  if (view.ref !== null) {
    ImGui.Image(view.ref, new ImVec2(w, h));
    hovered = ImGui.IsItemHovered();
  } else ui.dummy([w, h]);
  return { min, max: [min[0] + w, min[1] + h], iw, ih, hovered };
};

/** The Scene viewport — the editor camera's live render with status chrome. */
export const scenePanel = (
  state: StudioState,
  view: ViewportTarget,
  gizmos?: SceneGizmos,
  controller?: SceneCameraController,
  picker?: ScenePicker,
  orientation?: SceneOrientationGizmo,
): PanelDef => ({
  id: '/scene',
  title: 'Scene',
  icon: 'move-3d',
  slot: 'center',
  flush: true,
  render: ({ ui }: EditorContext): void => {
    const { min, max, iw, ih, hovered } = drawViewport(ui, view);
    const rect = { x: min[0], y: min[1], width: iw, height: ih };
    // The orientation gizmo (top-right) gets first claim on the pointer: while it
    // is hovered or dragging, viewport navigation, transform handles, and picking
    // all stand down so the user only drives the widget.
    const gizmoActive = orientation?.drawAndCapture(rect, hovered) ?? false;
    const navHovered = hovered && !gizmoActive;
    // Editor transform gizmos: capture input here (UI pass); the 3D handles are
    // emitted from a postUpdate system, the 2D drag readout is drawn here.
    gizmos?.capture(rect, navHovered);
    picker?.capture(rect, navHovered);
    gizmos?.drawOverlay();
    // Editor camera navigation + keyboard shortcuts share this pass: ImGui input
    // is only live while the panel body runs. The controller applies movement
    // from an update system; the shortcuts mutate editor state in place.
    controller?.capture(ih, navHovered);
    if (controller !== undefined) handleShortcuts(state, controller, hovered);
    const dl = Draw.window();
    const p = getActivePalette();

    // Top status chips (left); the top-right is the orientation gizmo's corner.
    const is2d = state.viewMode === '2d';
    let x = min[0] + 8;
    x += chip(dl, ui, [x, min[1] + 8], is2d ? 'grid-2x2' : 'video', is2d ? 'Orthographic' : 'Perspective', srgbU32(p.text));
    x += chip(dl, ui, [x, min[1] + 8], 'maximize', `${iw}×${ih}`, srgbU32(p.textMuted));
    if (state.playing) chip(dl, ui, [x, min[1] + 8], null, 'PLAYING', srgbU32(p.magenta400));

    if (state.playing) dl.rect([min[0] + 2, min[1] + 2], [max[0] - 2, max[1] - 2], srgbU32(p.magenta400), 0, 2);
  },
});

/** The Game viewport — the game camera's live render (always on, even when not playing). */
export const gamePanel = (state: StudioState, view: ViewportTarget): PanelDef => ({
  id: '/game',
  title: 'Game',
  icon: 'gamepad-2',
  slot: 'center',
  flush: true,
  render: ({ ui }: EditorContext): void => {
    const { min, max } = drawViewport(ui, view);
    const dl = Draw.window();
    const p = getActivePalette();
    const label = state.playing ? `Game · ${state.fps} fps` : 'Game · preview';
    chip(dl, ui, [min[0] + 8, min[1] + 8], 'gamepad-2', label, srgbU32(state.playing ? p.green400 : p.textMuted));
    if (state.playing) dl.rect([min[0] + 2, min[1] + 2], [max[0] - 2, max[1] - 2], srgbU32(p.magenta400), 0, 2);
  },
});
