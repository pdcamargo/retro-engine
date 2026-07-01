/**
 * Canvas overlays drawn on top of the graph: a minimap (category-colored node
 * blocks + a live viewport rectangle, click/drag to navigate), a status chip
 * (node/wire counts + hints), and a floating toolbar. All are screen-space and
 * sit above nodes.
 */

import type { Draw, Ui, Vec2 } from '@retro-engine/editor-sdk';

import type { GraphDocument, Point } from './document';
import type { GraphEnvironment } from './environment';
import type { GraphLayout } from './layout-cache';
import type { GraphTheme } from './theme';
import type { GraphView } from './view';

const MINIMAP_W = 176;
const MINIMAP_H = 116;
const MINIMAP_PAD = 10;

const categoryColorOf = (doc: GraphDocument, env: GraphEnvironment, typeId: string, theme: GraphTheme): number => {
  const cat = env.kind(doc.kindId)?.nodeTypes.get(typeId)?.category;
  const hex = (cat !== undefined ? env.categories.get(cat)?.color : undefined) ?? '#7d8a84';
  return theme.pack(hex);
};

/** The minimap's screen rectangle for the current canvas region. */
export const minimapRect = (origin: Vec2, size: Vec2): [Point, Point] => {
  const x1 = origin[0] + size[0] - MINIMAP_PAD;
  const y1 = origin[1] + size[1] - MINIMAP_PAD;
  return [
    [x1 - MINIMAP_W, y1 - MINIMAP_H],
    [x1, y1],
  ];
};

/**
 * Draw the minimap: node blocks colored by category and a rectangle showing the
 * region the canvas currently frames. Returns the content→minimap mapping so a
 * caller can convert a minimap click back to a world point.
 */
export const drawMinimap = (
  draw: Draw,
  doc: GraphDocument,
  layout: GraphLayout,
  view: GraphView,
  env: GraphEnvironment,
  theme: GraphTheme,
  origin: Vec2,
  size: Vec2,
): void => {
  const [mn, mx] = minimapRect(origin, size);
  draw.rectFilled(mn, mx, theme.pack('#0a0f0c', 210), 3);
  draw.rect(mn, mx, theme.chrome.border, 3, 1);
  if (layout.bounds === null) return;

  const [bx0, by0, bx1, by1] = layout.bounds;
  const pad = 40;
  const bw = bx1 - bx0 + pad * 2;
  const bh = by1 - by0 + pad * 2;
  const innerW = MINIMAP_W - 12;
  const innerH = MINIMAP_H - 12;
  const s = Math.min(innerW / bw, innerH / bh);
  const offX = mn[0] + 6 + (innerW - bw * s) / 2;
  const offY = mn[1] + 6 + (innerH - bh * s) / 2;
  const toMini = (wx: number, wy: number): Point => [offX + (wx - (bx0 - pad)) * s, offY + (wy - (by0 - pad)) * s];

  for (const [id, nl] of layout.nodes) {
    const a = toMini(nl.x, nl.y);
    const b = toMini(nl.x + nl.w, nl.y + nl.h);
    const col = categoryColorOf(doc, env, doc.nodes[id]?.typeId ?? '', theme);
    draw.rectFilled(a, [Math.max(b[0], a[0] + 1), Math.max(b[1], a[1] + 1)], col, 1);
  }

  // Viewport rectangle: the world region the canvas currently shows, clamped to
  // the minimap so it never spills onto the working area.
  const vx0 = -view.pan[0] / view.zoom;
  const vy0 = -view.pan[1] / view.zoom;
  const va = toMini(vx0, vy0);
  const vb = toMini(vx0 + size[0] / view.zoom, vy0 + size[1] / view.zoom);
  const cx = (x: number): number => Math.max(mn[0] + 1, Math.min(mx[0] - 1, x));
  const cy = (y: number): number => Math.max(mn[1] + 1, Math.min(mx[1] - 1, y));
  draw.rect([cx(va[0]), cy(va[1])], [cx(vb[0]), cy(vb[1])], theme.chrome.selection, 1, 1);
};

/** Recenter the view on a world point derived from a minimap click, if the click is inside the minimap. */
export const minimapNavigate = (
  ui: Ui,
  layout: GraphLayout,
  view: GraphView,
  origin: Vec2,
  size: Vec2,
): boolean => {
  if (layout.bounds === null || !ui.isMouseDown(0)) return false;
  const [mn, mx] = minimapRect(origin, size);
  const m = ui.mousePos();
  if (m[0] < mn[0] || m[0] > mx[0] || m[1] < mn[1] || m[1] > mx[1]) return false;

  const [bx0, by0, bx1, by1] = layout.bounds;
  const pad = 40;
  const bw = bx1 - bx0 + pad * 2;
  const bh = by1 - by0 + pad * 2;
  const innerW = MINIMAP_W - 12;
  const innerH = MINIMAP_H - 12;
  const s = Math.min(innerW / bw, innerH / bh);
  const offX = mn[0] + 6 + (innerW - bw * s) / 2;
  const offY = mn[1] + 6 + (innerH - bh * s) / 2;
  // Invert toMini: world under the minimap cursor.
  const wx = (m[0] - offX) / s + (bx0 - pad);
  const wy = (m[1] - offY) / s + (by0 - pad);
  // Center the canvas on (wx, wy).
  view.pan[0] = size[0] / 2 - wx * view.zoom;
  view.pan[1] = size[1] / 2 - wy * view.zoom;
  view.userNavigated = true;
  return true;
};

/** Draw the bottom-left status chip: node/wire counts + a hint. */
export const drawStatus = (
  draw: Draw,
  doc: GraphDocument,
  view: GraphView,
  theme: GraphTheme,
  origin: Vec2,
  size: Vec2,
): void => {
  const nodes = doc.nodeOrder.length;
  const wires = Object.keys(doc.edges).length;
  const text = `${nodes} nodes  ·  ${wires} wires  ·  ${Math.round(view.zoom * 100)}%`;
  const h = 22;
  const w = text.length * 7 + 20;
  const mn: Point = [origin[0] + 10, origin[1] + size[1] - 10 - h];
  const mx: Point = [mn[0] + w, mn[1] + h];
  draw.rectFilled(mn, mx, theme.chrome.headerBg, 3);
  draw.rect(mn, mx, theme.chrome.border, 3, 1);
  draw.textAt([mn[0] + 10, mn[1] + (h - 12) / 2], theme.chrome.textMuted, text, { size: 12 });
};
