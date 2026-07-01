/**
 * Per-frame derived geometry: each node's world-space rectangle, its body rows,
 * and its pin anchor points. Rendering and hit-testing both read this cache so
 * they never disagree. All coordinates are world space (pre-zoom).
 */

import type { GraphDocument, GraphNode, NodeId, Point } from './document';
import type { GraphEnvironment } from './environment';
import type { NodeTypeDescriptor } from './node-type';
import type { GraphGeometry } from './theme';

/** A laid-out pin: its declared name/type plus its world anchor on the node edge. */
export interface PinLayout {
  readonly name: string;
  readonly type: string;
  readonly dir: 'in' | 'out';
  /** World anchor point (on the node's left edge for inputs, right edge for outputs). */
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
  for (const p of type?.inputs ?? []) rowW = Math.max(rowW, (p.label ?? p.name).length * geo.fontLabel * 0.6 + 24);
  for (const p of type?.outputs ?? []) rowW = Math.max(rowW, (p.label ?? p.name).length * geo.fontLabel * 0.6 + 24);
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
  const w = estimateWidth(node, type, geo);
  const headerH = geo.headerH;

  if (node.collapsed) {
    const midY = y + headerH / 2;
    // Collapsed: pins collapse onto the header edges.
    const inputs: PinLayout[] = (type?.inputs ?? []).map((p) => ({
      name: p.name,
      type: p.type,
      dir: 'in' as const,
      anchor: [x, midY] as Point,
    }));
    const outputs: PinLayout[] = (type?.outputs ?? []).map((p) => ({
      name: p.name,
      type: p.type,
      dir: 'out' as const,
      anchor: [x + w, midY] as Point,
    }));
    return { id: node.id, x, y, w, h: headerH, headerH, collapsed: true, inputs, outputs, fields: [] };
  }

  const bodyPad = 6;
  let row = 0;
  const rowCy = (i: number): number => y + headerH + bodyPad + i * geo.rowH + geo.rowH / 2;

  const fields: FieldRowLayout[] = (type?.fields ?? []).map((f) => ({ name: f.name, cy: rowCy(row++) }));
  const inputs: PinLayout[] = (type?.inputs ?? []).map((p) => ({
    name: p.name,
    type: p.type,
    dir: 'in' as const,
    anchor: [x, rowCy(row++)] as Point,
  }));
  const outputs: PinLayout[] = (type?.outputs ?? []).map((p) => ({
    name: p.name,
    type: p.type,
    dir: 'out' as const,
    anchor: [x + w, rowCy(row++)] as Point,
  }));

  const h = headerH + bodyPad * 2 + row * geo.rowH;
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
