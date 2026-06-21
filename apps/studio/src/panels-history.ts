import { ImGui } from '@mori2003/jsimgui';
import {
  Draw,
  drawIcon,
  type EditorContext,
  getActivePalette,
  type History,
  type HistoryEntryKind,
  type HistoryEntryView,
  type IconName,
  type PanelDef,
  type Rgba,
  type Srgb8,
  srgbU32,
  type Vec2,
} from '@retro-engine/editor-sdk';
import { type App, Name } from '@retro-engine/engine';

import { type StudioState } from './state';

// Rail geometry (px). The lane-0 node sits at DOT0 from the row's left edge; the
// content column begins one gutter in, clearing the dot and its connector line.
const ROW = 30;
const DOT0 = 13;
const GUTTER = DOT0 + 14;
const DOT_R = 4.5;
const ICON = 13;
const HEADER_H = 36;
const FOOTER_H = 30;
const BTN = 26;

/** Action category → leading glyph. */
const KIND_ICON: Record<HistoryEntryKind, IconName> = {
  setField: 'pencil',
  addComponent: 'plus',
  removeComponent: 'trash-2',
  addBundle: 'package-plus',
  custom: 'box',
  batch: 'layers',
};

/** Action category → icon tint: add green, remove red, edit cyan, the rest muted. */
const toneOf = (p: ReturnType<typeof getActivePalette>, kind: HistoryEntryKind): Srgb8 => {
  switch (kind) {
    case 'addComponent':
      return p.green400;
    case 'removeComponent':
      return p.red400;
    case 'setField':
      return p.cyan400;
    default:
      return p.textMuted;
  }
};

const rgbaOf = (c: Srgb8): Rgba => [c[0] / 255, c[1] / 255, c[2] / 255, 1];

/** A scalar value as a short string (ASCII only — the UI font bakes no arrows/symbols). */
const fmtValue = (x: unknown): string | undefined => {
  if (typeof x === 'number') return Number.isInteger(x) ? String(x) : x.toFixed(2);
  if (typeof x === 'string') return x;
  if (typeof x === 'boolean') return x ? 'on' : 'off';
  return undefined;
};

/** A terse `before -> after` delta for a row's secondary text; omitted when either side isn't scalar. */
const detailOf = (e: HistoryEntryView): string | undefined => {
  if (e.kind !== 'setField') return undefined;
  const a = fmtValue(e.before);
  const b = fmtValue(e.after);
  return a === undefined || b === undefined ? undefined : `${a} -> ${b}`;
};

/** The affected entity's display name, looked up live (undefined if it has despawned or is unnamed). */
const targetOf = (app: App, e: HistoryEntryView): string | undefined => {
  if (e.entity === undefined || !app.world.hasEntity(e.entity)) return undefined;
  return app.world.getComponent(e.entity, Name)?.value;
};

/** A dashed vertical segment — ImGui has no native dashed stroke, so step short dashes. */
const dashedV = (dl: Draw, x: number, y0: number, y1: number, col: number): void => {
  for (let y = y0; y < y1; y += 6) dl.line([x, y], [x, Math.min(y + 3, y1)], col, 2);
};

/**
 * The HISTORY panel — the undo/redo timeline. A scrollable column of edits drawn
 * over a git-style rail (oldest at top, newest at bottom): a glowing node marks
 * the live state, entries below it are the dimmed redo tail, and clicking any row
 * jumps the world to that state. Header buttons and ⌘Z/⌘⇧Z drive undo/redo.
 */
export const historyPanel = (state: StudioState, app: App, history: History): PanelDef => ({
  id: '/history',
  title: 'History',
  icon: 'history',
  slot: 'right',
  closable: true,
  flush: true,
  render: ({ ui, widgets }: EditorContext): void => {
    const p = getActivePalette();
    const view = history.view();
    const total = view.entries.length;
    const cur = view.currentIndex;

    // Header toolbar — undo / redo / clear, right-aligned. The dock tab already
    // shows the panel title, so the body header is just the actions.
    ui.child('hist-header', { size: [0, HEADER_H], padding: [8, 6], noScrollbar: true }, () => {
      ui.rightAlign(3 * BTN + 2 * 4);
      ui.withDisabled(cur < 0, () => {
        if (widgets.iconButton('hist-undo', 'undo-2', { tooltip: 'Undo', size: 'sm' })) history.undo();
      });
      ui.sameLine(0, 4);
      ui.withDisabled(cur >= total - 1, () => {
        if (widgets.iconButton('hist-redo', 'redo-2', { tooltip: 'Redo', size: 'sm' })) history.redo();
      });
      ui.sameLine(0, 4);
      ui.withDisabled(total === 0, () => {
        if (widgets.iconButton('hist-clear', 'trash-2', { tooltip: 'Clear history', size: 'sm', danger: true })) {
          state.historyClearConfirm = true;
        }
      });
    });

    // Body — the scrolling rail list. Reserve the footer height below it.
    const bodyH = ui.contentAvail()[1] - FOOTER_H;
    ui.child('hist-body', { size: [0, bodyH], padding: [0, 4] }, () => {
      if (total === 0) {
        ui.dummy([0, 8]);
        ui.textDisabled('   No history yet.');
        return;
      }
      const dl = Draw.window();
      ui.withItemSpacing(0, 0, () => {
        const width = ui.contentAvail()[0];
        for (let i = 0; i < total; i++) {
          const e = view.entries[i]!;
          const isCur = i === cur;
          const isFuture = i > cur;

          const rowMin = ui.cursorScreenPos();
          const clicked = ui.invisibleButton(`##hist-${i}`, [width, ROW]);
          const hovered = ui.isItemHovered();
          if (clicked) history.jumpTo(i);
          if (isCur && state.historyLastCurrent !== cur) ImGui.SetScrollHereY(0.5);

          const rowMax: Vec2 = [rowMin[0] + width, rowMin[1] + ROW];
          const cy = rowMin[1] + ROW / 2;
          const dotX = rowMin[0] + DOT0;
          const contentX = rowMin[0] + GUTTER;
          const dim = isFuture ? (hovered ? 0.72 : 0.46) : 1;

          // Row background.
          if (isCur) dl.rectFilled(rowMin, rowMax, srgbU32(p.green400, 0.14));
          else if (hovered) dl.rectFilled(rowMin, rowMax, srgbU32(p.gray5));

          // Connector into this row from the one above. It stops short of both
          // node centers (a gap of dot radius + 2) so the line never pierces a dot.
          if (i > 0) {
            const y0 = cy - ROW + DOT_R + 2;
            const y1 = cy - DOT_R - 2;
            if (isFuture) dashedV(dl, dotX, y0, y1, srgbU32(p.green400, 0.4));
            else dl.line([dotX, y0], [dotX, y1], srgbU32(p.green400, 0.85), 2);
          }

          // Node dot — current is filled + glow; the rest are hollow rings.
          if (isCur) {
            dl.circleFilled([dotX, cy], DOT_R + 3, srgbU32(p.green400, 0.35));
            dl.circleFilled([dotX, cy], DOT_R, srgbU32(p.green400));
          } else {
            dl.circleFilled([dotX, cy], DOT_R, srgbU32(p.gray2));
            dl.circle([dotX, cy], DOT_R, srgbU32(p.green400, dim), 2);
          }

          // Current row: a 2px inset accent rail at the content's left edge.
          if (isCur) dl.rectFilled([contentX - 2, rowMin[1] + 3], [contentX, rowMax[1] - 3], srgbU32(p.green400));

          // Content: tone-tinted icon, label, accent target, faint delta.
          const ty = cy - ui.textLineHeight() / 2;
          drawIcon(KIND_ICON[e.kind], [contentX, cy - ICON / 2], ICON, srgbU32(toneOf(p, e.kind), dim));
          let x = contentX + ICON + 8;
          dl.text([x, ty], srgbU32(isCur || hovered ? p.white : p.textMuted, dim), e.label);
          x += ui.calcTextSize(e.label)[0] + 8;
          const target = targetOf(app, e);
          if (target !== undefined) {
            dl.text([x, ty], srgbU32(p.green300, dim), target);
            x += ui.calcTextSize(target)[0] + 8;
          }
          const detail = detailOf(e);
          if (detail !== undefined) dl.text([x, ty], srgbU32(p.textFaint, dim), detail);
        }
      });
    });

    // Footer — a status strip with the current step over the total.
    const footTop = ui.cursorScreenPos();
    Draw.window().line([footTop[0], footTop[1]], [footTop[0] + 9999, footTop[1]], srgbU32(p.borderSubtle));
    ui.child('hist-footer', { size: [0, 0], padding: [12, 7], noScrollbar: true }, () => {
      ui.textColored(rgbaOf(p.green400), String(cur + 1));
      ui.sameLine(0, 0);
      ui.textColored(rgbaOf(p.textFaint), ` / ${total} steps`);
    });

    state.historyLastCurrent = cur;
  },
});
