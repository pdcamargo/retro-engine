/**
 * Transient, per-view state: pan, zoom, selection, and the interaction state
 * machine. Never serialized into the document. The world→screen mapping is a
 * uniform affine `screen = origin + pan + world * zoom`, applied at draw time
 * (ImGui has no canvas transform); `origin` is the canvas's top-left in screen
 * space, supplied by the panel each frame.
 */

import type { Vec2 } from '@retro-engine/editor-sdk';

import type { EdgeId, NodeId, PinRef, Point, RerouteId } from './document';

/** The current pointer interaction; only committed results mutate the document. */
export type Interaction =
  | { k: 'idle' }
  | { k: 'panning'; startMouse: Point; startPan: Point; button: number }
  | { k: 'marquee'; startWorld: Point; additive: boolean }
  | { k: 'dragNode'; ids: NodeId[]; startMouse: Point; starts: Map<NodeId, Point>; moved: boolean }
  | { k: 'dragReroute'; id: RerouteId; grab: Point }
  | { k: 'dragGroup'; id: string; startMouse: Point; groupStart: Point; members: Map<NodeId, Point> }
  | { k: 'connecting'; from: PinRef; dir: 'in' | 'out'; candidate: PinRef | null };

/** The active canvas tool: dragging empty space pans (`'pan'`) or box-selects (`'select'`). */
export type GraphTool = 'pan' | 'select';

/** What the pointer is currently over (recomputed each frame). */
export type Hover =
  | { readonly k: 'node'; readonly id: NodeId }
  | { readonly k: 'pin'; readonly ref: PinRef; readonly dir: 'in' | 'out' }
  | { readonly k: 'reroute'; readonly id: RerouteId }
  | { readonly k: 'edge'; readonly id: EdgeId };

/** Per-view editor state. */
export interface GraphView {
  /** Screen-space translation of the world origin, in pixels. */
  pan: Point;
  /** Uniform zoom factor. */
  zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  /** Selected node ids. */
  selection: Set<NodeId>;
  /** Selected edge ids. */
  edgeSelection: Set<EdgeId>;
  /** Selected reroute-knot ids. */
  rerouteSelection: Set<RerouteId>;
  /** Selected group ids. */
  groupSelection: Set<string>;
  /** Active tool: `'pan'` (drag empty to pan) or `'select'` (drag empty to marquee). */
  tool: GraphTool;
  /** Whether the CRT scanline overlay is drawn. */
  scanlines: boolean;
  /** Set once the user has panned or zoomed — lets a host auto-frame until then. */
  userNavigated: boolean;
  interaction: Interaction;
  hovered: Hover | null;
}

/** Create a fresh view centered at the origin at 100% zoom. */
export const createGraphView = (opts?: Partial<Pick<GraphView, 'pan' | 'zoom' | 'scanlines'>>): GraphView => ({
  pan: opts?.pan ? [opts.pan[0], opts.pan[1]] : [0, 0],
  zoom: opts?.zoom ?? 1,
  minZoom: 0.35,
  maxZoom: 2,
  selection: new Set(),
  edgeSelection: new Set(),
  rerouteSelection: new Set(),
  groupSelection: new Set(),
  tool: 'pan',
  scanlines: opts?.scanlines ?? true,
  userNavigated: false,
  interaction: { k: 'idle' },
  hovered: null,
});

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Map a world point to screen space given the canvas origin. */
export const worldToScreen = (view: GraphView, origin: Vec2, wx: number, wy: number): Point => [
  origin[0] + view.pan[0] + wx * view.zoom,
  origin[1] + view.pan[1] + wy * view.zoom,
];

/** Map a screen point back to world space given the canvas origin. */
export const screenToWorld = (view: GraphView, origin: Vec2, sx: number, sy: number): Point => [
  (sx - origin[0] - view.pan[0]) / view.zoom,
  (sy - origin[1] - view.pan[1]) / view.zoom,
];

/**
 * Zoom toward a screen anchor (typically the cursor), keeping the world point
 * under the anchor fixed. Clamps to `[minZoom, maxZoom]`.
 */
export const zoomAt = (view: GraphView, origin: Vec2, anchor: Vec2, factor: number): void => {
  const next = clamp(view.zoom * factor, view.minZoom, view.maxZoom);
  if (next === view.zoom) return;
  const w = screenToWorld(view, origin, anchor[0], anchor[1]);
  view.zoom = next;
  // Solve pan so worldToScreen(w) === anchor again.
  view.pan[0] = anchor[0] - origin[0] - w[0] * next;
  view.pan[1] = anchor[1] - origin[1] - w[1] * next;
};

/** Pan by a screen-space delta. */
export const panBy = (view: GraphView, dx: number, dy: number): void => {
  view.pan[0] += dx;
  view.pan[1] += dy;
};
