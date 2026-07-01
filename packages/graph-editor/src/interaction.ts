/**
 * The pointer/keyboard interaction state machine. Runs once per frame: hit-tests
 * the cursor against the layout cache, then advances the explicit interaction
 * state (select / drag-node / marquee) and applies keyboard actions (delete,
 * nudge, frame). Only committed results mutate the document; navigation
 * (pan/zoom) is handled separately in {@link handleNavigation}.
 */

import { Keys, type Ui, type Vec2 } from '@retro-engine/editor-sdk';

import type { GraphDocument, NodeId, Point } from './document';
import { type GraphLayout, pick, type PickResult } from './layout-cache';
import { moveNode, removeNode, raiseNode } from './ops';
import type { GraphGeometry } from './theme';
import { type GraphView, type Hover, screenToWorld } from './view';

/** Everything the interaction step reads for one frame. */
export interface InteractionCtx {
  readonly ui: Ui;
  readonly doc: GraphDocument;
  readonly view: GraphView;
  readonly origin: Vec2;
  readonly layout: GraphLayout;
  readonly geo: GraphGeometry;
  /** Whether the canvas background item is hovered (gates press-to-start + keys). */
  readonly hovered: boolean;
}

const clearSelection = (view: GraphView): void => {
  view.selection.clear();
  view.edgeSelection.clear();
};

const hitToHover = (hit: PickResult | null): Hover | null => {
  if (hit === null) return null;
  if (hit.k === 'node') return { k: 'node', id: hit.id };
  if (hit.k === 'reroute') return { k: 'reroute', id: hit.id };
  return { k: 'pin', ref: { node: hit.node, pin: hit.pin }, dir: hit.dir };
};

/**
 * Advance interaction for the frame. Returns the current pick result (so the
 * caller can style hover / start a connection in a later phase).
 */
export const updateInteraction = (ctx: InteractionCtx): PickResult | null => {
  const { ui, doc, view, origin, layout, geo, hovered } = ctx;
  const mouse = ui.mousePos();
  const world = screenToWorld(view, origin, mouse[0], mouse[1]);
  const pinRadius = Math.max(geo.pinDot / 2 + 2, 8 / view.zoom);
  const rerouteRadius = Math.max(geo.rerouteSize / 2, 9 / view.zoom);
  const hit = hovered ? pick(layout, doc, world[0], world[1], { pinRadius, rerouteRadius }) : null;

  const st = view.interaction;
  switch (st.k) {
    case 'idle':
    case 'panning':
      if (hovered && ui.isMouseClicked(0)) startLeftPress(ctx, hit, world);
      break;
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

  if (hovered) handleKeys(ctx, world);
  view.hovered = hitToHover(hit);
  return hit;
};

const startLeftPress = (ctx: InteractionCtx, hit: PickResult | null, world: Point): void => {
  const { doc, view, ui } = ctx;
  const additive = ui.keyShift() || ui.keyCtrl();

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

  // Pins (connecting) and reroute knots (dragging) are wired in later phases.
  if (hit?.k === 'pin' || hit?.k === 'reroute') return;

  // Empty canvas: begin a marquee (clears first unless additive).
  if (!additive) clearSelection(view);
  view.interaction = { k: 'marquee', startWorld: [world[0], world[1]], additive };
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

const handleKeys = (ctx: InteractionCtx, _world: Point): void => {
  const { ui, doc, view } = ctx;
  if (ui.isKeyPressed(Keys.Delete) || ui.isKeyPressed(Keys.Backspace)) {
    for (const id of view.selection) removeNode(doc, id);
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
