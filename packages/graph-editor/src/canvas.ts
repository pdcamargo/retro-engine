/**
 * Canvas backdrop + navigation: the dotted grid, the CRT scanline overlay, and
 * cursor-anchored wheel zoom + middle-drag pan. Everything is drawn in screen
 * space using the view's world→screen affine.
 */

import type { Draw, Ui, Vec2 } from '@retro-engine/editor-sdk';

import type { GraphTheme } from './theme';
import { type GraphView, panBy, zoomAt } from './view';

export { gridBackground as drawGrid } from './background';

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
    if (wheel !== 0) {
      zoomAt(view, origin, ui.mousePos(), wheel > 0 ? 1.1 : 1 / 1.1);
      view.userNavigated = true;
    }
  }
  // Right- or middle-button drag pans (stateless). A two-finger trackpad
  // click-drag reports as the right button. Space+left-drag is handled by the
  // interaction state machine. Gated on hover so it only pans over the canvas.
  if (!hovered) return;
  for (const btn of [1, 2]) {
    if (ui.isMouseDragging(btn)) {
      const d = ui.mouseDragDelta(btn);
      panBy(view, d[0], d[1]);
      ui.resetMouseDragDelta(btn);
      view.userNavigated = true;
    }
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
