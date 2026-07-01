/**
 * Canvas backdrop + navigation: the dotted grid, the CRT scanline overlay, and
 * cursor-anchored wheel zoom + middle-drag pan. Everything is drawn in screen
 * space using the view's world→screen affine.
 */

import type { Draw, Ui, Vec2 } from '@retro-engine/editor-sdk';

import type { GraphTheme } from './theme';
import { type GraphView, panBy, zoomAt } from './view';

/** Draw the dotted grid over the canvas region. Skipped when dots get too dense. */
export const drawGrid = (draw: Draw, origin: Vec2, size: Vec2, view: GraphView, theme: GraphTheme): void => {
  const pitch = theme.geo.gridPitch * view.zoom;
  if (pitch < 6) return; // too dense to read; skip
  const [ox, oy] = origin;
  const [w, h] = size;
  const major = Math.max(2, Math.round(theme.geo.gridMajor));
  // Phase the grid to the pan so dots track content.
  const startX = ox + (((view.pan[0] % pitch) + pitch) % pitch);
  const startY = oy + (((view.pan[1] % pitch) + pitch) % pitch);
  // Index of the first column/row in world-dot units, for major-dot striping.
  const col0 = Math.round((startX - ox - view.pan[0]) / pitch);
  const row0 = Math.round((startY - oy - view.pan[1]) / pitch);
  let ci = 0;
  for (let x = startX; x <= ox + w; x += pitch, ci++) {
    let ri = 0;
    for (let y = startY; y <= oy + h; y += pitch, ri++) {
      const isMajor = (col0 + ci) % major === 0 && (row0 + ri) % major === 0;
      const r = isMajor ? 1.4 : 0.9;
      draw.rectFilled([x - r, y - r], [x + r, y + r], isMajor ? theme.chrome.gridDotMajor : theme.chrome.gridDot);
    }
  }
};

/** Draw the faint horizontal scanline wash over the canvas region. */
export const drawScanlines = (draw: Draw, origin: Vec2, size: Vec2, theme: GraphTheme): void => {
  const [ox, oy] = origin;
  const [w, h] = size;
  for (let y = oy; y <= oy + h; y += 3) draw.line([ox, y], [ox + w, y], theme.chrome.scanline, 1);
};

/**
 * Apply wheel zoom (cursor-anchored) and middle-drag pan for the frame. `hovered`
 * gates wheel/pan-start so the graph only navigates when the canvas is under the
 * cursor. Uses the drag-delta accumulator reset each frame for incremental pan.
 */
export const handleNavigation = (ui: Ui, view: GraphView, origin: Vec2, hovered: boolean): void => {
  if (hovered) {
    const wheel = ui.mouseWheel();
    if (wheel !== 0) zoomAt(view, origin, ui.mousePos(), wheel > 0 ? 1.1 : 1 / 1.1);
  }
  // Middle-button drag pans. Once a drag is in flight it keeps panning even if the
  // cursor briefly leaves the canvas; require hover only to begin.
  const panning = view.interaction.k === 'panning';
  if (ui.isMouseDragging(2) && (hovered || panning)) {
    const d = ui.mouseDragDelta(2);
    panBy(view, d[0], d[1]);
    ui.resetMouseDragDelta(2);
    if (!panning) view.interaction = { k: 'panning', startMouse: ui.mousePos(), startPan: [view.pan[0], view.pan[1]] };
  } else if (panning && !ui.isMouseDown(2)) {
    view.interaction = { k: 'idle' };
  }
};

/** Frame all content: set zoom + pan so `bounds` fills the region with padding. */
export const fitBounds = (
  view: GraphView,
  size: Vec2,
  bounds: readonly [number, number, number, number] | null,
): void => {
  if (bounds === null) return;
  const pad = 48;
  const bw = bounds[2] - bounds[0] + pad * 2;
  const bh = bounds[3] - bounds[1] + pad * 2;
  if (bw <= 0 || bh <= 0) return;
  const zoom = Math.min(view.maxZoom, Math.max(view.minZoom, Math.min(size[0] / bw, size[1] / bh)));
  view.zoom = zoom;
  // Center the padded bounds in the region: pan is screen-space translation of world origin.
  view.pan[0] = (size[0] - bw * zoom) / 2 - (bounds[0] - pad) * zoom;
  view.pan[1] = (size[1] - bh * zoom) / 2 - (bounds[1] - pad) * zoom;
};
