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
import { updateInteraction } from './interaction';
import { buildLayout, type GraphLayout, pinAnchor } from './layout-cache';
import { drawNode, pinKey } from './node-render';
import { drawMinimap, drawStatus, minimapNavigate } from './overlays';
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

const dashedRect = (draw: Draw, mn: Point, mx: Point, col: number, dash: number, gap: number, th: number): void => {
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len === 0) return;
    const dx = (x1 - x0) / len;
    const dy = (y1 - y0) / len;
    for (let s = 0; s < len; s += dash + gap) {
      const e = Math.min(s + dash, len);
      draw.line([x0 + dx * s, y0 + dy * s], [x0 + dx * e, y0 + dy * e], col, th);
    }
  };
  seg(mn[0], mn[1], mx[0], mn[1]);
  seg(mx[0], mn[1], mx[0], mx[1]);
  seg(mx[0], mx[1], mn[0], mx[1]);
  seg(mn[0], mx[1], mn[0], mn[1]);
};

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

  if (edge.style === 'transition') {
    // State-machine transition: connect node edges (not pins), arrowhead + badge.
    const rightward = toL.x + toL.w / 2 >= fromL.x + fromL.w / 2;
    const aw: Point = [rightward ? fromL.x + fromL.w : fromL.x, fromL.y + fromL.headerH / 2];
    const bw: Point = [rightward ? toL.x : toL.x + toL.w, toL.y + toL.headerH / 2];
    const a = worldToScreen(view, origin, aw[0], aw[1]);
    const b = worldToScreen(view, origin, bw[0], bw[1]);
    const selected = view.edgeSelection.has(edge.id);
    const col = selected ? theme.chrome.selection : theme.pack('#8a938d');
    drawWire(draw, [a, b], col, (selected ? theme.geo.wireWSel : theme.geo.wireW) * view.zoom, view.zoom);
    // Arrowhead at the target, pointing into the node.
    const dir = rightward ? 1 : -1;
    const s = 7 * view.zoom;
    draw.triFilled([b[0], b[1] - s * 0.7], [b[0], b[1] + s * 0.7], [b[0] + dir * s, b[1]], col);
    // Midpoint glyph badge.
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const r = 9 * view.zoom;
    draw.circleFilled(mid, r, theme.chrome.headerBg);
    draw.circle(mid, r, selected ? theme.chrome.selection : theme.chrome.borderStrong, Math.max(1, view.zoom));
    if (edge.label !== undefined && view.zoom >= 0.4) {
      draw.textAt([mid[0] - edge.label.length * 3 * view.zoom, mid[1] - 5 * view.zoom], theme.chrome.textMuted, edge.label, { size: 9 * view.zoom });
    }
    return;
  }

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

    // Hit-test against a pre-interaction layout, run navigation + interaction
    // (which may move nodes), then rebuild the layout so wires/pins track nodes
    // within the same frame (no one-frame drag lag).
    const pickLayout = buildLayout(doc, env, theme.geo);
    // Minimap click/drag navigation takes precedence over canvas interaction.
    const overMinimap = minimapNavigate(ui, pickLayout, view, origin, size);
    const canvasHovered = hovered && !overMinimap;
    handleNavigation(ui, view, origin, canvasHovered);
    updateInteraction({ ui, doc, view, env, origin, layout: pickLayout, geo: theme.geo, hovered: canvasHovered });

    const layout = buildLayout(doc, env, theme.geo);
    const draw = Draw.window();
    drawGrid(draw, origin, size, view, theme);
    if (view.scanlines) drawScanlines(draw, origin, size, theme);

    const connected = connectedPins(doc);
    const kind = env.kind(doc.kindId);

    // Subgraph groups behind everything: translucent tint, dashed border, title tab.
    for (const g of Object.values(doc.groups)) {
      const catHex = (g.categoryId !== undefined ? env.categories.get(g.categoryId)?.color : undefined) ?? '#67a6fb';
      const selected = view.groupSelection.has(g.id);
      const mn = worldToScreen(view, origin, g.rect[0], g.rect[1]);
      const mx: Point = [mn[0] + g.rect[2] * view.zoom, mn[1] + g.rect[3] * view.zoom];
      const borderCol = selected ? theme.chrome.selection : theme.pack(catHex);
      draw.rectFilled(mn, mx, theme.pack(catHex, 18), 6 * view.zoom);
      dashedRect(draw, mn, mx, borderCol, 6 * view.zoom, 4 * view.zoom, Math.max(1, (selected ? 2 : 1) * view.zoom));
      if (view.zoom >= 0.4) {
        const tabH = 16 * view.zoom;
        const tabW = (g.title.length * 6.5 + 16) * view.zoom;
        draw.rectFilled([mn[0], mn[1] - tabH], [mn[0] + tabW, mn[1]], theme.pack(catHex, selected ? 120 : 70), 3 * view.zoom);
        draw.textAt([mn[0] + 8 * view.zoom, mn[1] - tabH + 2 * view.zoom], theme.chrome.textBright, g.title, { size: theme.geo.fontLabel * view.zoom });
      }
    }

    // Wires behind nodes.
    for (const edge of Object.values(doc.edges)) drawEdge(draw, edge, layout, origin, params);

    // Reroute weight-points, colored by their edge's data type, above wires.
    for (const knot of Object.values(doc.reroutes)) {
      const edge = doc.edges[knot.edge];
      const dt = edge !== undefined ? env.edgeDataType(doc, edge) : undefined;
      const col = dt !== undefined ? theme.colorFor(dt.name, dt.color) : theme.chrome.textMuted;
      const c = worldToScreen(view, origin, knot.pos[0], knot.pos[1]);
      const r = (theme.geo.rerouteSize * view.zoom) / 2;
      draw.circleFilled(c, r, col);
      draw.circle(c, r, theme.pack('#0a0f0c'), Math.max(1, 2 * view.zoom));
      if (view.rerouteSelection.has(knot.id)) draw.circle(c, r + 2 * view.zoom, theme.chrome.selection, Math.max(1, view.zoom));
    }

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

    // In-progress connection wire (source pin → cursor or candidate pin).
    if (view.interaction.k === 'connecting') {
      const c = view.interaction;
      const srcL = layout.nodes.get(c.from.node);
      const srcAnchor = srcL !== undefined ? pinAnchor(srcL, c.from.pin, c.dir) : undefined;
      if (srcAnchor !== undefined) {
        const srcPins = c.dir === 'out' ? srcL!.outputs : srcL!.inputs;
        const srcType = srcPins.find((p) => p.name === c.from.pin)?.type ?? 'float';
        const src = worldToScreen(view, origin, srcAnchor[0], srcAnchor[1]);
        const m = ui.mousePos();
        let end: Point = [m[0], m[1]];
        let ok = true;
        if (c.candidate !== null) {
          const candL = layout.nodes.get(c.candidate.node);
          const candAnchor = candL !== undefined ? pinAnchor(candL, c.candidate.pin, c.dir === 'out' ? 'in' : 'out') : undefined;
          if (candAnchor !== undefined) end = worldToScreen(view, origin, candAnchor[0], candAnchor[1]);
          const out = c.dir === 'out' ? c.from : c.candidate;
          const inp = c.dir === 'out' ? c.candidate : c.from;
          ok = env.canConnect(doc, out, inp);
        }
        const col = c.candidate !== null && !ok ? theme.chrome.danger : theme.colorFor(srcType, env.dataTypes.get(srcType)?.color ?? '#34e07a');
        // Draw output-first so the horizontal-tangent shape reads correctly.
        const pts: Point[] = c.dir === 'out' ? [src, end] : [end, src];
        drawWire(draw, pts, col, theme.geo.wireW * view.zoom, view.zoom);
      }
    }

    // Marquee selection rectangle (over nodes).
    if (view.interaction.k === 'marquee') {
      const a = worldToScreen(view, origin, view.interaction.startWorld[0], view.interaction.startWorld[1]);
      const m = ui.mousePos();
      draw.rectFilled([Math.min(a[0], m[0]), Math.min(a[1], m[1])], [Math.max(a[0], m[0]), Math.max(a[1], m[1])], theme.pack('#ffc233', 30));
      draw.rect([Math.min(a[0], m[0]), Math.min(a[1], m[1])], [Math.max(a[0], m[0]), Math.max(a[1], m[1])], theme.chrome.selection, 0, 1);
    }

    // Overlays (above nodes): minimap + status chip.
    drawMinimap(draw, doc, layout, view, env, theme, origin, size);
    drawStatus(draw, doc, view, theme, origin, size);
  },

  /** Frame all nodes in the current region with padding. Call after a layout pass. */
  fit(params: GraphDrawParams): void {
    const { ui, doc, view, env, theme } = params;
    const size = ui.contentAvail();
    const layout = buildLayout(doc, env, theme.geo);
    fitBounds(view, size, layout.bounds);
  },
};
