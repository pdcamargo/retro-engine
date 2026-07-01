/**
 * The per-frame orchestrator. Given the immediate-mode `ui`, a document, a view,
 * an environment, and a theme, it draws the whole graph inside the current
 * panel's content region: canvas backdrop → navigation → wires → nodes. A single
 * background invisible button captures empty-canvas hover/input; nodes and pins
 * are hit-tested manually against the layout cache in later phases.
 */

import { Draw, type Ui, type Vec2 } from '@retro-engine/editor-sdk';

import { drawGrid, drawScanlines, fitBounds, handleNavigation } from './canvas';
import type { GraphDocument, GraphEdge, Point } from './document';
import type { GraphEnvironment } from './environment';
import { buildLayout, type GraphLayout, pinAnchor } from './layout-cache';
import { drawNode, pinKey } from './node-render';
import type { GraphTheme } from './theme';
import { type GraphView, worldToScreen } from './view';
import { drawWire } from './wire';

/** Everything one frame of the editor needs. */
export interface GraphDrawParams {
  readonly ui: Ui;
  readonly doc: GraphDocument;
  readonly view: GraphView;
  readonly env: GraphEnvironment;
  readonly theme: GraphTheme;
}

const connectedPins = (doc: GraphDocument): Set<string> => {
  const set = new Set<string>();
  for (const e of Object.values(doc.edges)) {
    set.add(pinKey(e.from.node, 'out', e.from.pin));
    set.add(pinKey(e.to.node, 'in', e.to.pin));
  }
  return set;
};

const drawEdge = (
  draw: Draw,
  edge: GraphEdge,
  layout: GraphLayout,
  origin: Vec2,
  params: GraphDrawParams,
): void => {
  const { doc, env, theme, view } = params;
  const fromL = layout.nodes.get(edge.from.node);
  const toL = layout.nodes.get(edge.to.node);
  if (fromL === undefined || toL === undefined) return;
  const a = pinAnchor(fromL, edge.from.pin, 'out');
  const b = pinAnchor(toL, edge.to.pin, 'in');
  if (a === undefined || b === undefined) return;

  const dt = env.edgeDataType(doc, edge);
  const exec = dt?.shape === 'triangle';
  const col = dt !== undefined ? theme.colorFor(dt.name, dt.color) : theme.chrome.textMuted;
  const selected = view.edgeSelection.has(edge.id);
  const thickness = (selected ? theme.geo.wireWSel : exec ? theme.geo.wireWExec : theme.geo.wireW) * view.zoom;

  const worldPts: Point[] = [a];
  for (const knot of edge.via) {
    const r = doc.reroutes[knot];
    if (r !== undefined) worldPts.push(r.pos);
  }
  worldPts.push(b);
  const screenPts = worldPts.map((wp) => worldToScreen(view, origin, wp[0], wp[1]));
  drawWire(draw, screenPts, selected ? theme.chrome.selection : col, thickness, view.zoom);
};

/**
 * The graph editor surface. Stateless — all state lives in the passed `view` and
 * `doc`. Call {@link GraphEditor.draw} inside a panel body each frame.
 */
export const GraphEditor = {
  /** Draw the graph into the current panel's content region for one frame. */
  draw(params: GraphDrawParams): void {
    const { ui, doc, view, env, theme } = params;
    const origin = ui.cursorScreenPos();
    const size = ui.contentAvail();

    // Background input surface: hover/active for empty-canvas navigation.
    ui.invisibleButton('graph::canvas', size);
    const hovered = ui.isItemHovered();
    handleNavigation(ui, view, origin, hovered);

    const draw = Draw.window();
    drawGrid(draw, origin, size, view, theme);
    if (view.scanlines) drawScanlines(draw, origin, size, theme);

    const layout = buildLayout(doc, env, theme.geo);
    const connected = connectedPins(doc);
    const kind = env.kind(doc.kindId);

    // Wires behind nodes.
    for (const edge of Object.values(doc.edges)) drawEdge(draw, edge, layout, origin, params);

    // Nodes back-to-front.
    for (const id of doc.nodeOrder) {
      const node = doc.nodes[id];
      const nl = layout.nodes.get(id);
      if (node === undefined || nl === undefined) continue;
      drawNode({
        draw,
        node,
        layout: nl,
        type: kind?.nodeTypes.get(node.typeId),
        view,
        origin,
        env,
        theme,
        selected: view.selection.has(id),
        connected,
      });
    }
  },

  /** Frame all nodes in the current region with padding. Call after a layout pass. */
  fit(params: GraphDrawParams): void {
    const { ui, doc, view, env, theme } = params;
    const size = ui.contentAvail();
    const layout = buildLayout(doc, env, theme.geo);
    fitBounds(view, size, layout.bounds);
  },
};
