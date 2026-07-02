/**
 * Per-frame derived geometry: each node's world-space rectangle, its body rows,
 * and its pin anchor points. Rendering and hit-testing both read this cache so
 * they never disagree. All coordinates are world space (pre-zoom).
 */

import type { GraphDocument, GraphNode, NodeId, Point } from './document';
import type { GraphEnvironment } from './environment';
import type { PinDescriptor } from './node-type';
import type { NodeTypeDescriptor } from './node-type';
import type { Side } from './side';
import type { GraphGeometry } from './theme';

/** A laid-out pin: its declared name/type plus its world anchor on the node edge. */
export interface PinLayout {
  readonly name: string;
  readonly type: string;
  readonly dir: 'in' | 'out';
  /** Display label next to the pin dot; falls back to `name` when absent. */
  readonly label?: string;
  /** The node edge this pin docks on. */
  readonly side: Side;
  /** World anchor point on the node's `side` edge. */
  readonly anchor: Point;
}

/** A laid-out embedded field row: its name and world Y center. */
export interface FieldRowLayout {
  readonly name: string;
  readonly cy: number;
}

/** A node's computed geometry for one frame. */
export interface NodeLayout {
  readonly id: NodeId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly headerH: number;
  readonly collapsed: boolean;
  readonly inputs: readonly PinLayout[];
  readonly outputs: readonly PinLayout[];
  readonly fields: readonly FieldRowLayout[];
}

/** The whole document's layout plus its world-space content bounds. */
export interface GraphLayout {
  readonly nodes: Map<NodeId, NodeLayout>;
  /** `[minX, minY, maxX, maxY]`, or `null` when the document is empty. */
  readonly bounds: readonly [number, number, number, number] | null;
}

const estimateWidth = (node: GraphNode, type: NodeTypeDescriptor | undefined, geo: GraphGeometry): number => {
  if (node.size?.[0] !== undefined) return node.size[0];
  const title = node.title ?? type?.label ?? node.typeId;
  const charW = geo.fontTitle * 0.6;
  // Header: icon + title + sub-label; body: widest input/output label pair.
  const headerW = 24 + title.length * charW + 34;
  let rowW = 0;
  for (const p of node.inputs ?? type?.inputs ?? []) rowW = Math.max(rowW, (p.label ?? p.name).length * geo.fontLabel * 0.6 + 24);
  for (const p of node.outputs ?? type?.outputs ?? []) rowW = Math.max(rowW, (p.label ?? p.name).length * geo.fontLabel * 0.6 + 24);
  return Math.max(geo.nodeMinW, Math.ceil(Math.max(headerW, rowW)));
};

/** Compute one node's layout. */
export const layoutNode = (
  node: GraphNode,
  type: NodeTypeDescriptor | undefined,
  geo: GraphGeometry,
): NodeLayout => {
  const x = node.pos[0];
  const y = node.pos[1];
  const m = type?.measure?.(node);
  const w = m?.w ?? estimateWidth(node, type, geo);
  const headerH = m?.headerH ?? geo.headerH;

  if (node.collapsed) {
    const midY = y + headerH / 2;
    // Collapsed: pins collapse onto the header edges.
    const inputs: PinLayout[] = (node.inputs ?? type?.inputs ?? []).map((p) => ({
      name: p.name,
      type: p.type,
      dir: 'in' as const,
      side: 'left' as const,
      anchor: [x, midY] as Point,
    }));
    const outputs: PinLayout[] = (node.outputs ?? type?.outputs ?? []).map((p) => ({
      name: p.name,
      type: p.type,
      dir: 'out' as const,
      side: 'right' as const,
      anchor: [x + w, midY] as Point,
    }));
    return { id: node.id, x, y, w, h: headerH, headerH, collapsed: true, inputs, outputs, fields: [] };
  }

  // Context/VFX stack: a titled vertical block list (each field is a block).
  if (type?.style === 'stack') {
    const cap = 4;
    const titleH = 30;
    const blockH = 40;
    const addH = 26;
    const pad = 8;
    const fields: FieldRowLayout[] = (type.fields ?? []).map((f, i) => ({
      name: f.name,
      cy: y + cap + titleH + pad + i * (blockH + 6) + blockH / 2,
    }));
    const h = cap + titleH + pad + fields.length * (blockH + 6) + addH + pad;
    return { id: node.id, x, y, w, h, headerH: cap + titleH, collapsed: false, inputs: [], outputs: [], fields };
  }

  const bodyPad = 6;
  let row = 0;
  const rowCy = (i: number): number => y + headerH + bodyPad + i * geo.rowH + geo.rowH / 2;

  const fields: FieldRowLayout[] = (type?.fields ?? []).map((f) => ({ name: f.name, cy: rowCy(row++) }));

  const sideOf = (p: PinDescriptor, dir: 'in' | 'out'): Side => p.side ?? (dir === 'in' ? 'left' : 'right');
  const inPins = node.inputs ?? type?.inputs ?? [];
  const outPins = node.outputs ?? type?.outputs ?? [];

  // Left/right pins occupy body rows (the single-column layout); top/bottom pins
  // are distributed along their edge after the body height is known.
  const inputs: PinLayout[] = [];
  const outputs: PinLayout[] = [];
  const deferred: { p: PinDescriptor; dir: 'in' | 'out'; side: Side }[] = [];
  const rowPin = (p: PinDescriptor, dir: 'in' | 'out', side: Side): PinLayout => ({
    name: p.name,
    type: p.type,
    dir,
    ...(p.label !== undefined ? { label: p.label } : {}),
    side,
    anchor: [side === 'left' ? x : x + w, rowCy(row++)] as Point,
  });
  for (const p of inPins) {
    const side = sideOf(p, 'in');
    if (side === 'left' || side === 'right') inputs.push(rowPin(p, 'in', side));
    else deferred.push({ p, dir: 'in', side });
  }
  for (const p of outPins) {
    const side = sideOf(p, 'out');
    if (side === 'left' || side === 'right') outputs.push(rowPin(p, 'out', side));
    else deferred.push({ p, dir: 'out', side });
  }

  const h = m?.h ?? headerH + bodyPad * 2 + row * geo.rowH;

  // Top/bottom pins spread evenly across the node's width on their edge.
  const topPins = deferred.filter((d) => d.side === 'top');
  const bottomPins = deferred.filter((d) => d.side === 'bottom');
  const spread = (list: typeof deferred, edgeY: number): void => {
    list.forEach((d, i) => {
      const pin: PinLayout = {
        name: d.p.name,
        type: d.p.type,
        dir: d.dir,
        ...(d.p.label !== undefined ? { label: d.p.label } : {}),
        side: d.side,
        anchor: [x + (w * (i + 1)) / (list.length + 1), edgeY] as Point,
      };
      (d.dir === 'in' ? inputs : outputs).push(pin);
    });
  };
  spread(topPins, y);
  spread(bottomPins, y + h);

  return { id: node.id, x, y, w, h, headerH, collapsed: false, inputs, outputs, fields };
};

/** Build the layout for every node in the document, plus content bounds. */
export const buildLayout = (doc: GraphDocument, env: GraphEnvironment, geo: GraphGeometry): GraphLayout => {
  const kind = env.kind(doc.kindId);
  const nodes = new Map<NodeId, NodeLayout>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of doc.nodeOrder) {
    const node = doc.nodes[id];
    if (node === undefined) continue;
    const type = kind?.nodeTypes.get(node.typeId);
    const l = layoutNode(node, type, geo);
    nodes.set(id, l);
    minX = Math.min(minX, l.x);
    minY = Math.min(minY, l.y);
    maxX = Math.max(maxX, l.x + l.w);
    maxY = Math.max(maxY, l.y + l.h);
  }
  const bounds = nodes.size > 0 ? ([minX, minY, maxX, maxY] as const) : null;
  return { nodes, bounds };
};

/** Find the world anchor of a pin from a node layout, or `undefined`. */
export const pinAnchor = (layout: NodeLayout, pin: string, dir: 'in' | 'out'): Point | undefined =>
  (dir === 'in' ? layout.inputs : layout.outputs).find((p) => p.name === pin)?.anchor;

/** What a world-space point is over. */
export type PickResult =
  | { readonly k: 'pin'; readonly node: NodeId; readonly pin: string; readonly dir: 'in' | 'out' }
  | { readonly k: 'field'; readonly node: NodeId; readonly name: string }
  | { readonly k: 'reroute'; readonly id: string }
  | { readonly k: 'group'; readonly id: string }
  | { readonly k: 'groupResize'; readonly id: string }
  | { readonly k: 'node'; readonly id: NodeId };

/** Approximate world height of a group's title tab (its drag handle). */
export const GROUP_TAB_H = 16;

const dist2 = (a: Point, bx: number, by: number): number => {
  const dx = a[0] - bx;
  const dy = a[1] - by;
  return dx * dx + dy * dy;
};

/**
 * Hit-test a world point against the layout, top-most first. Within a node the
 * precedence is pins → fields → body; reroute knots are tested before nodes.
 * `pinRadius` / `rerouteRadius` / `rowHalf` are world-space hit sizes (a caller
 * derives them from geometry + zoom so targets stay comfortable at any zoom).
 */
export const pick = (
  layout: GraphLayout,
  doc: GraphDocument,
  wx: number,
  wy: number,
  opts: { pinRadius: number; rerouteRadius: number; rowHalf: number },
): PickResult | null => {
  const pinR2 = opts.pinRadius * opts.pinRadius;
  const rerouteR2 = opts.rerouteRadius * opts.rerouteRadius;
  for (const r of Object.values(doc.reroutes)) {
    if (dist2(r.pos, wx, wy) <= rerouteR2) return { k: 'reroute', id: r.id };
  }
  // Group resize handles (bottom-right corner) then title tabs (drag handles).
  const handle = Math.max(14, opts.rerouteRadius);
  for (const g of Object.values(doc.groups)) {
    const cx = g.rect[0] + g.rect[2];
    const cy = g.rect[1] + g.rect[3];
    if (wx >= cx - handle && wx <= cx && wy >= cy - handle && wy <= cy) return { k: 'groupResize', id: g.id };
  }
  for (const g of Object.values(doc.groups)) {
    const tabW = g.title.length * 6.5 + 16;
    if (wx >= g.rect[0] && wx <= g.rect[0] + tabW && wy >= g.rect[1] - GROUP_TAB_H && wy <= g.rect[1]) {
      return { k: 'group', id: g.id };
    }
  }
  for (let i = doc.nodeOrder.length - 1; i >= 0; i--) {
    const nl = layout.nodes.get(doc.nodeOrder[i]!);
    if (nl === undefined) continue;
    for (const pin of nl.inputs) if (dist2(pin.anchor, wx, wy) <= pinR2) return { k: 'pin', node: nl.id, pin: pin.name, dir: 'in' };
    for (const pin of nl.outputs) if (dist2(pin.anchor, wx, wy) <= pinR2) return { k: 'pin', node: nl.id, pin: pin.name, dir: 'out' };
    const inside = wx >= nl.x && wx <= nl.x + nl.w && wy >= nl.y && wy <= nl.y + nl.h;
    if (inside) {
      for (const f of nl.fields) if (Math.abs(wy - f.cy) <= opts.rowHalf) return { k: 'field', node: nl.id, name: f.name };
      return { k: 'node', id: nl.id };
    }
  }
  return null;
};
