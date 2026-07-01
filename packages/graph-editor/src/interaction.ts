/**
 * The pointer/keyboard interaction state machine. Runs once per frame: hit-tests
 * the cursor against the layout cache, then advances the explicit interaction
 * state (select / drag-node / marquee / connecting) and applies keyboard actions
 * (delete, nudge, frame). Only committed results mutate the document; navigation
 * (pan/zoom) is handled separately in {@link handleNavigation}.
 */

import { Keys, type Ui, type Vec2 } from '@retro-engine/editor-sdk';

import type { EdgeId, GraphDocument, NodeId, Point } from './document';
import type { GraphEnvironment } from './environment';
import { type GraphLayout, pick, type PickResult, pinAnchor } from './layout-cache';
import {
  addReroute,
  connect,
  disconnect,
  moveNode,
  moveReroute,
  removeGroup,
  removeNode,
  removeReroute,
  raiseNode,
  setFieldValue,
} from './ops';
import type { GraphGeometry } from './theme';
import { type GraphView, type Hover, screenToWorld, worldToScreen } from './view';
import { wireDistance } from './wire';

/** Everything the interaction step reads for one frame. */
export interface InteractionCtx {
  readonly ui: Ui;
  readonly doc: GraphDocument;
  readonly view: GraphView;
  readonly env: GraphEnvironment;
  readonly origin: Vec2;
  readonly layout: GraphLayout;
  readonly geo: GraphGeometry;
  /** Whether the canvas background item is hovered (gates press-to-start + keys). */
  readonly hovered: boolean;
}

const clearSelection = (view: GraphView): void => {
  view.selection.clear();
  view.edgeSelection.clear();
  view.rerouteSelection.clear();
  view.groupSelection.clear();
};

const hitToHover = (hit: PickResult | null): Hover | null => {
  if (hit === null || hit.k === 'field' || hit.k === 'group') return null;
  if (hit.k === 'node') return { k: 'node', id: hit.id };
  if (hit.k === 'reroute') return { k: 'reroute', id: hit.id };
  return { k: 'pin', ref: { node: hit.node, pin: hit.pin }, dir: hit.dir };
};

/** Toggle/cycle a clicked embedded field. Continuous fields (number/swatch) are no-ops here. */
const editField = (ctx: InteractionCtx, nodeId: NodeId, name: string): void => {
  const { doc, env } = ctx;
  const node = doc.nodes[nodeId];
  if (node === undefined) return;
  const fd = env.kind(doc.kindId)?.nodeTypes.get(node.typeId)?.fields?.find((f) => f.name === name);
  if (fd === undefined) return;
  const cur = node.fieldValues[name] ?? fd.default;
  if (fd.kind === 'toggle' || fd.kind === 'checkbox') {
    setFieldValue(doc, nodeId, name, cur !== true);
  } else if (fd.kind === 'combo' && fd.options !== undefined && fd.options.length > 0) {
    const i = Math.max(0, fd.options.indexOf(String(cur)));
    setFieldValue(doc, nodeId, name, fd.options[(i + 1) % fd.options.length]);
  }
};

/** Screen-space wire hit-test: the id of the wire nearest the point within tolerance, else null. */
const pickEdge = (ctx: InteractionCtx, sx: number, sy: number): EdgeId | null => {
  const { doc, view, origin, layout } = ctx;
  let best = 7; // px tolerance
  let bestId: EdgeId | null = null;
  for (const edge of Object.values(doc.edges)) {
    const fromL = layout.nodes.get(edge.from.node);
    const toL = layout.nodes.get(edge.to.node);
    if (fromL === undefined || toL === undefined) continue;
    const a = pinAnchor(fromL, edge.from.pin, 'out');
    const b = pinAnchor(toL, edge.to.pin, 'in');
    if (a === undefined || b === undefined) continue;
    const pts: Point[] = [worldToScreen(view, origin, a[0], a[1])];
    for (const k of edge.via) {
      const r = doc.reroutes[k];
      if (r !== undefined) pts.push(worldToScreen(view, origin, r.pos[0], r.pos[1]));
    }
    pts.push(worldToScreen(view, origin, b[0], b[1]));
    const d = wireDistance(pts, sx, sy, view.zoom);
    if (d < best) {
      best = d;
      bestId = edge.id;
    }
  }
  return bestId;
};

/**
 * Advance interaction for the frame. Returns the current pick result (so the
 * caller can style hover / draw the in-progress connection).
 */
export const updateInteraction = (ctx: InteractionCtx): PickResult | null => {
  const { ui, doc, view, env, origin, layout, geo, hovered } = ctx;
  const mouse = ui.mousePos();
  const world = screenToWorld(view, origin, mouse[0], mouse[1]);
  const pinRadius = Math.max(geo.pinDot / 2 + 2, 8 / view.zoom);
  const rerouteRadius = Math.max(geo.rerouteSize / 2, 9 / view.zoom);
  const hit = hovered ? pick(layout, doc, world[0], world[1], { pinRadius, rerouteRadius, rowHalf: geo.rowH / 2 }) : null;

  const st = view.interaction;
  switch (st.k) {
    case 'idle':
      // Double-click on a wire drops a reroute weight-point there.
      if (hovered && ui.isMouseDoubleClicked(0) && (hit === null || hit.k === 'reroute')) {
        const edgeId = pickEdge(ctx, mouse[0], mouse[1]);
        if (edgeId !== null) addReroute(doc, edgeId, [world[0], world[1]], insertIndexFor(ctx, edgeId, world[0]));
      } else if (hovered && ui.isMouseClicked(0)) {
        startLeftPress(ctx, hit, world, mouse);
      }
      break;
    case 'panning':
      if (ui.isMouseDown(st.button)) {
        view.pan[0] = st.startPan[0] + (mouse[0] - st.startMouse[0]);
        view.pan[1] = st.startPan[1] + (mouse[1] - st.startMouse[1]);
        view.userNavigated = true;
      } else {
        view.interaction = { k: 'idle' };
      }
      break;
    case 'dragReroute':
      if (ui.isMouseDown(0)) moveReroute(doc, st.id, [world[0] - st.grab[0], world[1] - st.grab[1]]);
      else view.interaction = { k: 'idle' };
      break;
    case 'dragGroup': {
      if (ui.isMouseDown(0)) {
        const dx = world[0] - st.startMouse[0];
        const dy = world[1] - st.startMouse[1];
        const g = doc.groups[st.id];
        if (g !== undefined) {
          g.rect[0] = st.groupStart[0] + dx;
          g.rect[1] = st.groupStart[1] + dy;
        }
        for (const [id, p] of st.members) moveNode(doc, id, [p[0] + dx, p[1] + dy]);
      } else {
        view.interaction = { k: 'idle' };
      }
      break;
    }
    case 'dragNode': {
      if (ui.isMouseDown(0)) {
        const dx = world[0] - st.startMouse[0];
        const dy = world[1] - st.startMouse[1];
        if (dx !== 0 || dy !== 0) st.moved = true;
        for (const id of st.ids) {
          const s = st.starts.get(id);
          if (s !== undefined) moveNode(doc, id, [s[0] + dx, s[1] + dy]);
        }
      } else {
        view.interaction = { k: 'idle' };
      }
      break;
    }
    case 'connecting': {
      // A candidate is a pin on the opposite side of a different node.
      st.candidate =
        hit?.k === 'pin' && hit.dir !== st.dir && hit.node !== st.from.node
          ? { node: hit.node, pin: hit.pin }
          : null;
      if (!ui.isMouseDown(0)) {
        if (st.candidate !== null) {
          const out = st.dir === 'out' ? st.from : st.candidate;
          const inp = st.dir === 'out' ? st.candidate : st.from;
          if (env.canConnect(doc, out, inp)) connect(doc, out, inp);
        }
        view.interaction = { k: 'idle' };
      }
      break;
    }
    case 'marquee':
      if (!ui.isMouseDown(0)) {
        applyMarquee(ctx, st.startWorld, world, st.additive);
        view.interaction = { k: 'idle' };
      }
      break;
    default:
      if (!ui.isMouseDown(0)) view.interaction = { k: 'idle' };
      break;
  }

  if (hovered) handleKeys(ctx);
  view.hovered = hitToHover(hit);
  return hit;
};

const startLeftPress = (ctx: InteractionCtx, hit: PickResult | null, world: Point, mouse: Vec2): void => {
  const { doc, view, ui, layout } = ctx;
  const additive = ui.keyShift() || ui.keyCtrl();

  if (hit?.k === 'field') {
    editField(ctx, hit.node, hit.name);
    return;
  }

  if (hit?.k === 'group') {
    const g = doc.groups[hit.id];
    if (g !== undefined) {
      if (!additive) clearSelection(view);
      view.groupSelection.add(hit.id);
      // Drag the group with the nodes it contains.
      const members = new Map<NodeId, Point>();
      for (const id of doc.nodeOrder) {
        const n = doc.nodes[id];
        const nl = layout.nodes.get(id);
        if (n === undefined || nl === undefined) continue;
        if (n.pos[0] >= g.rect[0] && n.pos[1] >= g.rect[1] && n.pos[0] + nl.w <= g.rect[0] + g.rect[2] && n.pos[1] + nl.h <= g.rect[1] + g.rect[3]) {
          members.set(id, [n.pos[0], n.pos[1]]);
        }
      }
      view.interaction = { k: 'dragGroup', id: hit.id, startMouse: [world[0], world[1]], groupStart: [g.rect[0], g.rect[1]], members };
    }
    return;
  }

  if (hit?.k === 'node') {
    if (view.selection.has(hit.id)) {
      if (additive) view.selection.delete(hit.id);
    } else {
      if (!additive) clearSelection(view);
      view.selection.add(hit.id);
    }
    raiseNode(doc, hit.id);
    const starts = new Map<NodeId, Point>();
    for (const id of view.selection) {
      const n = doc.nodes[id];
      if (n !== undefined) starts.set(id, [n.pos[0], n.pos[1]]);
    }
    view.interaction = { k: 'dragNode', ids: [...view.selection], startMouse: [world[0], world[1]], starts, moved: false };
    return;
  }

  if (hit?.k === 'pin') {
    view.interaction = { k: 'connecting', from: { node: hit.node, pin: hit.pin }, dir: hit.dir, candidate: null };
    return;
  }

  if (hit?.k === 'reroute') {
    if (!additive) clearSelection(view);
    view.rerouteSelection.add(hit.id);
    const knot = doc.reroutes[hit.id];
    if (knot !== undefined) view.interaction = { k: 'dragReroute', id: hit.id, grab: [world[0] - knot.pos[0], world[1] - knot.pos[1]] };
    return;
  }

  // Empty canvas: a wire under the cursor selects that edge.
  const edgeId = pickEdge(ctx, mouse[0], mouse[1]);
  if (edgeId !== null) {
    if (!additive) clearSelection(view);
    view.edgeSelection.add(edgeId);
    return;
  }

  // Otherwise pan (pan tool or Space held) or begin a marquee (select tool).
  const panMode = (view.tool === 'pan' || ui.isKeyDown(Keys.Space)) && !additive;
  if (panMode) {
    view.interaction = { k: 'panning', startMouse: [mouse[0], mouse[1]], startPan: [view.pan[0], view.pan[1]], button: 0 };
    return;
  }
  if (!additive) clearSelection(view);
  view.interaction = { k: 'marquee', startWorld: [world[0], world[1]], additive };
};

/** Where to insert a new reroute among an edge's existing knots, ordered by world x. */
const insertIndexFor = (ctx: InteractionCtx, edgeId: string, wx: number): number => {
  const edge = ctx.doc.edges[edgeId];
  if (edge === undefined) return 0;
  let i = 0;
  for (const knotId of edge.via) {
    const r = ctx.doc.reroutes[knotId];
    if (r !== undefined && r.pos[0] < wx) i++;
  }
  return i;
};

const applyMarquee = (ctx: InteractionCtx, a: Point, b: Point, additive: boolean): void => {
  const { view, layout } = ctx;
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  if (!additive) clearSelection(view);
  for (const [id, nl] of layout.nodes) {
    if (nl.x < x1 && nl.x + nl.w > x0 && nl.y < y1 && nl.y + nl.h > y0) view.selection.add(id);
  }
};

const handleKeys = (ctx: InteractionCtx): void => {
  const { ui, doc, view } = ctx;
  if (ui.isKeyPressed(Keys.Delete) || ui.isKeyPressed(Keys.Backspace)) {
    for (const id of view.rerouteSelection) removeReroute(doc, id);
    for (const id of view.edgeSelection) disconnect(doc, id);
    for (const id of view.selection) removeNode(doc, id);
    for (const id of view.groupSelection) removeGroup(doc, id);
    clearSelection(view);
  }
  if (ui.isKeyPressed(Keys.F)) view.userNavigated = false; // re-arm host auto-frame
  const step = ui.keyShift() ? 10 : 1;
  let dx = 0;
  let dy = 0;
  if (ui.isKeyPressed(Keys.LeftArrow, true)) dx -= step;
  if (ui.isKeyPressed(Keys.RightArrow, true)) dx += step;
  if (ui.isKeyPressed(Keys.UpArrow, true)) dy -= step;
  if (ui.isKeyPressed(Keys.DownArrow, true)) dy += step;
  if (dx !== 0 || dy !== 0) {
    for (const id of view.selection) {
      const n = doc.nodes[id];
      if (n !== undefined) moveNode(doc, id, [n.pos[0] + dx, n.pos[1] + dy]);
    }
  }
};
