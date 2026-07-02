/**
 * Edge geometry resolution + the built-in edge renderer. `resolveEdgeGeom` maps an
 * edge to its screen-space {@link EdgeShape} once; both drawing (here) and
 * hit-testing (`interaction.pickEdge`) read it, so a wire is picked exactly where
 * it is drawn — including its reroute waypoints, for every edge type. The default
 * renderer honors the edge type's arrowheads, midpoint badge, and reciprocal
 * merge; a type can replace it wholesale via `EdgeTypeDescriptor.render`.
 */

import type { Draw, Vec2 } from '@retro-engine/editor-sdk';

import type { GraphDocument, GraphEdge, Point } from './document';
import {
  drawEdgeShape,
  type EdgeShape,
  edgeShapeMidpoint,
  edgeShapeTangents,
  type EndpointGeom,
} from './edge-path';
import type { EdgeTypeDescriptor } from './edge-type';
import type { GraphEnvironment } from './environment';
import type { GraphLayout, NodeLayout } from './layout-cache';
import { autoSides, oppositeSide, type Side, sideMidpoint } from './side';
import type { GraphTheme } from './theme';
import { type GraphView, worldToScreen } from './view';

/** Everything the edge renderer reads for one edge. */
export interface EdgeRenderCtx {
  readonly draw: Draw;
  readonly edge: GraphEdge;
  readonly desc: EdgeTypeDescriptor;
  readonly doc: GraphDocument;
  readonly env: GraphEnvironment;
  readonly theme: GraphTheme;
  readonly view: GraphView;
  readonly layout: GraphLayout;
  readonly origin: Vec2;
  readonly selected: boolean;
}

/** Draws one edge to the draw list. */
export type EdgeRenderer = (ctx: EdgeRenderCtx) => void;

/** The reciprocal edge (target→source, same type), if one exists. */
export const reciprocalPartner = (doc: GraphDocument, edge: GraphEdge): GraphEdge | undefined => {
  for (const e of Object.values(doc.edges)) {
    if (e.id !== edge.id && (e.style ?? 'default') === (edge.style ?? 'default') && e.from.node === edge.to.node && e.to.node === edge.from.node) {
      return e;
    }
  }
  return undefined;
};

/**
 * Whether the draw loop should skip an edge because it is the non-primary half of a
 * merged reciprocal pair (the primary — smaller id — draws the single line for both).
 */
export const isMergedAway = (doc: GraphDocument, desc: EdgeTypeDescriptor, edge: GraphEdge): boolean => {
  if (desc.mergeReciprocal !== true) return false;
  const partner = reciprocalPartner(doc, edge);
  return partner !== undefined && edge.id > partner.id;
};

const pinSide = (layout: NodeLayout, pin: string, dir: 'in' | 'out'): { anchor: Point; side: Side } | undefined => {
  const p = (dir === 'in' ? layout.inputs : layout.outputs).find((q) => q.name === pin);
  if (p === undefined) return undefined;
  return { anchor: p.anchor, side: p.side ?? (dir === 'out' ? 'right' : 'left') };
};

/**
 * Resolve an edge to its concrete screen-space shape + endpoints, or `undefined`
 * when a node/pin can't be resolved. `endpoints: 'nodes'` attaches to the facing
 * node edges (auto-docked); `'pins'` attaches to the declared pin anchors.
 */
export const resolveEdgeGeom = (
  edge: GraphEdge,
  desc: EdgeTypeDescriptor,
  doc: GraphDocument,
  env: GraphEnvironment,
  view: GraphView,
  origin: Vec2,
  layout: GraphLayout,
): { shape: EdgeShape; from: EndpointGeom; to: EndpointGeom } | undefined => {
  const fromL = layout.nodes.get(edge.from.node);
  const toL = layout.nodes.get(edge.to.node);
  if (fromL === undefined || toL === undefined) return undefined;

  let fromWorld: Point;
  let toWorld: Point;
  let fromSideVal: Side;
  let toSideVal: Side;

  if ((desc.endpoints ?? 'pins') === 'nodes') {
    const dock = desc.dock ?? 'auto';
    if (dock === 'auto') {
      const s = autoSides(fromL, toL);
      fromSideVal = s.from;
      toSideVal = s.to;
    } else {
      fromSideVal = dock;
      toSideVal = oppositeSide(dock);
    }
    fromWorld = sideMidpoint(fromL, fromSideVal);
    toWorld = sideMidpoint(toL, toSideVal);
  } else {
    const fp = pinSide(fromL, edge.from.pin, 'out');
    const tp = pinSide(toL, edge.to.pin, 'in');
    if (fp === undefined || tp === undefined) return undefined;
    fromWorld = fp.anchor;
    toWorld = tp.anchor;
    fromSideVal = fp.side;
    toSideVal = tp.side;
  }

  const from: EndpointGeom = { pos: worldToScreen(view, origin, fromWorld[0], fromWorld[1]), side: fromSideVal };
  const to: EndpointGeom = { pos: worldToScreen(view, origin, toWorld[0], toWorld[1]), side: toSideVal };
  const waypoints: Point[] = [];
  for (const knot of edge.via) {
    const r = doc.reroutes[knot];
    if (r !== undefined) waypoints.push(worldToScreen(view, origin, r.pos[0], r.pos[1]));
  }
  const pathFn = env.edgePath(desc.path);
  return { shape: pathFn({ from, to, waypoints, zoom: view.zoom }), from, to };
};

/** Draw a filled arrowhead at `tip`, pointing along unit direction `dir`. */
const arrowhead = (draw: Draw, tip: Point, dir: Point, size: number, col: number): void => {
  const [ux, uy] = dir;
  const px = -uy;
  const py = ux;
  const b1: Point = [tip[0] - ux * size + px * size * 0.55, tip[1] - uy * size + py * size * 0.55];
  const b2: Point = [tip[0] - ux * size - px * size * 0.55, tip[1] - uy * size - py * size * 0.55];
  draw.triFilled(b1, b2, tip, col);
};

const edgeColor = (ctx: EdgeRenderCtx): number => {
  if (ctx.selected) return ctx.theme.chrome.selection;
  if ((ctx.desc.endpoints ?? 'pins') === 'nodes') return ctx.theme.pack('#8a938d');
  const dt = ctx.env.edgeDataType(ctx.doc, ctx.edge);
  return dt !== undefined ? ctx.theme.colorFor(dt.name, dt.color) : ctx.theme.chrome.textMuted;
};

/** The built-in renderer used unless an edge type supplies its own `render`. */
export const drawDefaultEdge: EdgeRenderer = (ctx) => {
  const { draw, edge, desc, doc, env, theme, view, origin, layout } = ctx;
  const geom = resolveEdgeGeom(edge, desc, doc, env, view, origin, layout);
  if (geom === undefined) return;

  const dt = (desc.endpoints ?? 'pins') === 'nodes' ? undefined : env.edgeDataType(doc, edge);
  const exec = dt?.shape === 'triangle';
  const col = edgeColor(ctx);
  const thickness = (ctx.selected ? theme.geo.wireWSel : exec ? theme.geo.wireWExec : theme.geo.wireW) * view.zoom;
  drawEdgeShape(draw, geom.shape, col, thickness);

  // Arrowheads, oriented by the actual path tangents (not the chord).
  const partner = desc.mergeReciprocal === true ? reciprocalPartner(doc, edge) : undefined;
  const wantEnd = desc.arrow?.end ?? (desc.endpoints ?? 'pins') === 'nodes';
  const wantStart = desc.arrow?.start === true || partner !== undefined;
  if (wantEnd || wantStart) {
    const t = edgeShapeTangents(geom.shape);
    const s = 8 * view.zoom;
    if (wantEnd) arrowhead(draw, geom.to.pos, t.end, s, col);
    if (wantStart) arrowhead(draw, geom.from.pos, [-t.start[0], -t.start[1]], s, col);
  }

  // Midpoint glyph badge.
  if (desc.badge === true) {
    const mid = edgeShapeMidpoint(geom.shape);
    const r = 9 * view.zoom;
    draw.circleFilled(mid, r, theme.chrome.headerBg);
    draw.circle(mid, r, ctx.selected ? theme.chrome.selection : theme.chrome.borderStrong, Math.max(1, view.zoom));
    if (edge.label !== undefined && view.zoom >= 0.4) {
      draw.textAt([mid[0] - edge.label.length * 3 * view.zoom, mid[1] - 5 * view.zoom], theme.chrome.textMuted, edge.label, {
        size: 9 * view.zoom,
      });
    }
  }
};
