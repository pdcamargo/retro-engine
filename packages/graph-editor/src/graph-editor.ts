/**
 * The per-frame orchestrator. Given the immediate-mode `ui`, a document, a view,
 * an environment, and a theme, it draws the whole graph inside the current
 * panel's content region: canvas backdrop → navigation → wires → nodes. A single
 * background invisible button captures empty-canvas hover/input; nodes and pins
 * are hit-tested manually against the layout cache in later phases.
 */

import { Draw, type History, type Ui, type Vec2 } from '@retro-engine/editor-sdk';

import { drawScanlines, fitBounds, handleNavigation } from './canvas';
import type { GraphDocument, GraphEdge, Point } from './document';
import { drawDefaultEdge, isMergedAway } from './edge-render';
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
  /** When provided, direct-manipulation edits record undo entries here (ADR-0139). */
  readonly history?: History;
  /**
   * Toggles for the canvas overlays. Both default to shown; a consumer that owns
   * its own chrome (e.g. a breadcrumb with zoom) can hide the minimap and the
   * node/wire/zoom status chip.
   */
  readonly overlays?: { readonly minimap?: boolean; readonly status?: boolean };
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
  const desc = env.edgeType(doc.kindId, edge.style);
  // The primary (smaller-id) half of a merged reciprocal pair draws the one line.
  if (isMergedAway(doc, desc, edge)) return;
  const renderer = desc.render ?? drawDefaultEdge;
  renderer({ draw, edge, desc, doc, env, theme, view, layout, origin, selected: view.edgeSelection.has(edge.id) });
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
    const showMinimap = params.overlays?.minimap ?? true;
    const showStatus = params.overlays?.status ?? true;

    const pickLayout = buildLayout(doc, env, theme.geo);
    // Minimap click/drag navigation takes precedence over canvas interaction.
    const overMinimap = showMinimap ? minimapNavigate(ui, pickLayout, view, origin, size) : false;
    const canvasHovered = hovered && !overMinimap;
    handleNavigation(ui, view, origin, canvasHovered);
    updateInteraction({ ui, doc, view, env, origin, layout: pickLayout, geo: theme.geo, hovered: canvasHovered, ...(params.history !== undefined ? { history: params.history } : {}) });

    const layout = buildLayout(doc, env, theme.geo);
    const draw = Draw.window();
    // Paint the canvas void so the graph reads on its own dark backdrop rather than
    // the host panel's child surface.
    draw.rectFilled(origin, [origin[0] + size[0], origin[1] + size[1]], theme.chrome.canvasBg);
    env.background(view.background)(draw, origin, size, view, theme);
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
      // Bottom-right resize handle.
      const hs = 12 * view.zoom;
      draw.triFilled([mx[0] - hs, mx[1]], [mx[0], mx[1] - hs], [mx[0], mx[1]], borderCol);
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

    // Overlays (above nodes): minimap + status chip, each opt-out.
    if (showMinimap) drawMinimap(draw, doc, layout, view, env, theme, origin, size);
    if (showStatus) drawStatus(draw, doc, view, theme, origin, size);
  },

  /** Frame all nodes in the current region with padding. Call after a layout pass. */
  fit(params: GraphDrawParams): void {
    const { ui, doc, view, env, theme } = params;
    const size = ui.contentAvail();
    const layout = buildLayout(doc, env, theme.geo);
    fitBounds(view, size, layout.bounds);
  },
};
