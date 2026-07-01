/**
 * Pure, in-place mutations on a {@link GraphDocument}. These are the primitive
 * state transitions the editor's interaction layer and the MCP commands drive;
 * the undo layer wraps them into recorded field edits. They are mechanical —
 * connection-type validation lives at the registry layer (a caller checks a
 * kind's `canConnect` before calling {@link connect}).
 */

import {
  type EdgeId,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type GraphReroute,
  type HeaderVariant,
  mintId,
  type NodeId,
  type PinRef,
  type Point,
  type RerouteId,
} from './document';

/** Fields accepted when spawning a node. `id` is minted when omitted. */
export interface AddNodeSpec {
  id?: NodeId;
  typeId: string;
  pos: Point;
  title?: string;
  headerVariant?: HeaderVariant;
  fieldValues?: Record<string, unknown>;
}

/** Add a node and place it on top of the z-order. Returns the created node. */
export const addNode = (doc: GraphDocument, spec: AddNodeSpec): GraphNode => {
  const id = spec.id ?? mintId(doc, 'node');
  const node: GraphNode = {
    id,
    typeId: spec.typeId,
    pos: [spec.pos[0], spec.pos[1]],
    fieldValues: { ...spec.fieldValues },
  };
  if (spec.title !== undefined) node.title = spec.title;
  if (spec.headerVariant !== undefined) node.headerVariant = spec.headerVariant;
  doc.nodes[id] = node;
  doc.nodeOrder.push(id);
  return node;
};

/** Every edge touching a node (as source or target). */
export const incidentEdges = (doc: GraphDocument, node: NodeId): GraphEdge[] =>
  Object.values(doc.edges).filter((e) => e.from.node === node || e.to.node === node);

/** Remove a node together with its incident edges and their reroute knots. */
export const removeNode = (doc: GraphDocument, id: NodeId): void => {
  if (doc.nodes[id] === undefined) return;
  for (const edge of incidentEdges(doc, id)) disconnect(doc, edge.id);
  delete doc.nodes[id];
  const i = doc.nodeOrder.indexOf(id);
  if (i >= 0) doc.nodeOrder.splice(i, 1);
};

/** Set a node's world position in place. */
export const moveNode = (doc: GraphDocument, id: NodeId, pos: Point): void => {
  const node = doc.nodes[id];
  if (node === undefined) return;
  node.pos[0] = pos[0];
  node.pos[1] = pos[1];
};

/** Raise a node to the top of the z-order (drawn last). */
export const raiseNode = (doc: GraphDocument, id: NodeId): void => {
  const i = doc.nodeOrder.indexOf(id);
  if (i < 0 || i === doc.nodeOrder.length - 1) return;
  doc.nodeOrder.splice(i, 1);
  doc.nodeOrder.push(id);
};

/** Whether a matching edge already exists between two pins. */
export const findEdge = (doc: GraphDocument, from: PinRef, to: PinRef): GraphEdge | undefined =>
  Object.values(doc.edges).find(
    (e) =>
      e.from.node === from.node &&
      e.from.pin === from.pin &&
      e.to.node === to.node &&
      e.to.pin === to.pin,
  );

/**
 * Create an edge from an output pin to an input pin. Mechanical: rejects only a
 * self-node connection or an exact duplicate; type compatibility is the caller's
 * responsibility. Returns the edge, or `undefined` if rejected.
 */
export const connect = (doc: GraphDocument, from: PinRef, to: PinRef): GraphEdge | undefined => {
  if (from.node === to.node) return undefined;
  if (findEdge(doc, from, to) !== undefined) return undefined;
  const id = mintId(doc, 'edge');
  const edge: GraphEdge = { id, from: { ...from }, to: { ...to }, via: [] };
  doc.edges[id] = edge;
  return edge;
};

/** Remove an edge and any reroute knots threaded onto it. */
export const disconnect = (doc: GraphDocument, edgeId: EdgeId): void => {
  const edge = doc.edges[edgeId];
  if (edge === undefined) return;
  for (const knot of edge.via) delete doc.reroutes[knot];
  delete doc.edges[edgeId];
};

/**
 * Drop a reroute weight-point onto an edge. `atIndex` inserts it among the
 * existing knots (source→target order); omitted, it appends. Returns the knot.
 */
export const addReroute = (
  doc: GraphDocument,
  edgeId: EdgeId,
  pos: Point,
  atIndex?: number,
): GraphReroute | undefined => {
  const edge = doc.edges[edgeId];
  if (edge === undefined) return undefined;
  const id = mintId(doc, 'reroute');
  const knot: GraphReroute = { id, edge: edgeId, pos: [pos[0], pos[1]] };
  doc.reroutes[id] = knot;
  const at = atIndex ?? edge.via.length;
  edge.via.splice(Math.max(0, Math.min(at, edge.via.length)), 0, id);
  return knot;
};

/** Remove a reroute knot, rejoining its neighbors on the edge. */
export const removeReroute = (doc: GraphDocument, rerouteId: RerouteId): void => {
  const knot = doc.reroutes[rerouteId];
  if (knot === undefined) return;
  const edge = doc.edges[knot.edge];
  if (edge !== undefined) {
    const i = edge.via.indexOf(rerouteId);
    if (i >= 0) edge.via.splice(i, 1);
  }
  delete doc.reroutes[rerouteId];
};

/** Move a reroute knot in place. */
export const moveReroute = (doc: GraphDocument, id: RerouteId, pos: Point): void => {
  const knot = doc.reroutes[id];
  if (knot === undefined) return;
  knot.pos[0] = pos[0];
  knot.pos[1] = pos[1];
};

/** Set one embedded field value on a node. */
export const setFieldValue = (
  doc: GraphDocument,
  nodeId: NodeId,
  name: string,
  value: unknown,
): void => {
  const node = doc.nodes[nodeId];
  if (node === undefined) return;
  node.fieldValues[name] = value;
};

/** Toggle a node's collapsed state. */
export const setCollapsed = (doc: GraphDocument, nodeId: NodeId, collapsed: boolean): void => {
  const node = doc.nodes[nodeId];
  if (node !== undefined) node.collapsed = collapsed;
};
