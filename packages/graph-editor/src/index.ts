/**
 * `@retro-engine/graph-editor` — a reusable immediate-mode node-graph editing
 * toolkit for the Retro Engine studio.
 *
 * One editor component renders and edits any node graph: dataflow (shader /
 * material), exec-flow blueprints, state machines, VFX context stacks, and
 * subgraphs. Consumers register their own {@link GraphKind}s (node types, data
 * types, connection rules) against a {@link GraphEnvironment} and map their
 * runtime graph to/from the toolkit's generic document model — the toolkit
 * never depends on any specific consumer.
 *
 * The public surface is re-exported here; implementations live in
 * concern-named sibling files.
 */

export type {
  NodeId,
  EdgeId,
  RerouteId,
  GroupId,
  Point,
  Rect,
  HeaderVariant,
  PinRef,
  GraphNode,
  GraphEdge,
  GraphReroute,
  GraphGroup,
  GraphCounters,
  GraphDocument,
} from './document';
export { createGraphDocument, mintId } from './document';

export type { AddNodeSpec } from './ops';
export {
  addNode,
  removeNode,
  moveNode,
  raiseNode,
  incidentEdges,
  findEdge,
  connect,
  disconnect,
  addReroute,
  removeReroute,
  moveReroute,
  setFieldValue,
  setCollapsed,
} from './ops';

export { GRAPH_FORMAT_VERSION, serializeGraph, deserializeGraph } from './serialize';
