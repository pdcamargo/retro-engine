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

import { type StudioState } from './state';

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

const drawGizmo = (dl: Draw, cx: number, cy: number): void => {
  const p = getActivePalette();
  const len = 34;
  dl.line([cx, cy], [cx + len, cy], srgbU32(p.red400), 2); // X
  dl.line([cx, cy], [cx, cy - len], srgbU32(p.green400), 2); // Y
  dl.line([cx, cy], [cx - len * 0.7, cy + len * 0.5], srgbU32(p.cyan400), 2); // Z
  dl.circleFilled([cx, cy], 3, srgbU32(p.amber400));
};

/** The Scene viewport — a stylized canvas placeholder (no live 3D render yet). */
export const scenePanel = (state: StudioState): PanelDef => ({
  id: '/scene',
  title: 'Scene',
  icon: 'move-3d',
  slot: 'center',
  flush: true,
  render: ({ ui }: EditorContext): void => {
    const min = ui.cursorScreenPos();
    const size = ui.contentAvail();
    const max: Vec2 = [min[0] + size[0], min[1] + size[1]];
    const dl = Draw.window();
    const p = getActivePalette();
    dl.rectFilled(min, max, srgbU32(p.gray0));
    // Dotted grid.
    const dot = srgbU32(p.gray6, 0.5);
    for (let y = min[1] + 16; y < max[1]; y += 24) {
      for (let x = min[0] + 16; x < max[0]; x += 24) dl.rectFilled([x, y], [x + 1.5, y + 1.5], dot);
    }
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    // Selected entity box.
    const half = 42;
    dl.rectFilled([cx - half, cy - half], [cx + half, cy + half], srgbU32(p.green400, 0.12), 2);
    dl.rect([cx - half, cy - half], [cx + half, cy + half], srgbU32(p.green400), 2, 1.5);
    drawIcon('box', [cx - 12, cy - 12], 24, srgbU32(p.green400));
    // Amber selection marquee + corner handles.
    const m = half + 6;
    dl.rect([cx - m, cy - m], [cx + m, cy + m], srgbU32(p.amber400, 0.9), 0, 1);
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const hx = cx + sx * m;
      const hy = cy + sy * m;
      dl.rectFilled([hx - 3, hy - 3], [hx + 3, hy + 3], srgbU32(p.amber400));
    }
    if (state.tool === 'move') drawGizmo(dl, cx, cy);

    // Top status chips (left).
    let x = min[0] + 8;
    x += chip(dl, ui, [x, min[1] + 8], 'video', 'Perspective', srgbU32(p.text));
    x += chip(dl, ui, [x, min[1] + 8], 'maximize', '1920×1080', srgbU32(p.textMuted));
    if (state.playing) chip(dl, ui, [x, min[1] + 8], null, 'PLAYING', srgbU32(p.magenta400));
    // Right chips.
    const ents = state.scene.entities.filter((e) => e.group !== true).length;
    const fpsText = `${state.fps} fps`;
    const entText = `${ents} ent`;
    const fpsW = chipWidth('activity', fpsText);
    const entW = chipWidth('box', entText);
    chip(dl, ui, [max[0] - fpsW - 8, min[1] + 8], 'activity', fpsText, srgbU32(p.green400));
    chip(dl, ui, [max[0] - fpsW - entW - 8, min[1] + 8], 'box', entText, srgbU32(p.textMuted));

    // Axis indicator (bottom-left) + nav cube (top-right).
    drawGizmo(dl, min[0] + 34, max[1] - 36);
    Draw.window().logoCube([max[0] - 50, min[1] + 38], 36);

    // Play-mode inset border.
    if (state.playing) dl.rect([min[0] + 2, min[1] + 2], [max[0] - 2, max[1] - 2], srgbU32(p.magenta400), 0, 2);

    ui.dummy(size);
  },
});

/** The Game viewport — empty until play mode. */
export const gamePanel = (state: StudioState): PanelDef => ({
  id: '/game',
  title: 'Game',
  icon: 'gamepad-2',
  slot: 'center',
  flush: true,
  render: ({ ui }: EditorContext): void => {
    const min = ui.cursorScreenPos();
    const size = ui.contentAvail();
    const dl = Draw.window();
    const p = getActivePalette();
    dl.rectFilled(min, [min[0] + size[0], min[1] + size[1]], srgbU32(p.gray0));
    const text = state.playing
      ? `Game running — ${state.fps} fps`
      : 'Press  ▶  Play to enter the game view';
    const ts = ui.calcTextSize(text);
    dl.text(
      [min[0] + (size[0] - ts[0]) / 2, min[1] + size[1] / 2 - ts[1] / 2],
      srgbU32(state.playing ? p.green400 : p.textFaint),
      text,
    );
    ui.dummy(size);
  },
});
