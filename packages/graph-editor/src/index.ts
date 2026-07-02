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
  addGroup,
  moveGroup,
  removeGroup,
  nodesInGroup,
} from './ops';

export { GRAPH_FORMAT_VERSION, serializeGraph, deserializeGraph } from './serialize';

export type { DocSnapshot } from './edit';
export { snapshotDoc, restoreDoc, snapshotCommand, recordGraphEdit } from './edit';

export type { PinShape, DataTypeDescriptor } from './data-type';
export { BUILTIN_DATA_TYPES, DataTypeRegistry } from './data-type';
export type { CategoryDescriptor } from './category';
export { BUILTIN_CATEGORIES, CategoryRegistry } from './category';
export type { FieldKind, FieldDescriptor } from './field';
export type { PinDescriptor, NodeTypeDescriptor, NodeStyle } from './node-type';
export { NodeTypeRegistry } from './node-type';
export type { ResolvedPin, ConnectRule, GraphKindOptions } from './kind';
export { GraphKind, defaultConnectRule } from './kind';
export { GraphEnvironment, createGraphEnvironment } from './environment';

export type { Side, PortSide, SideRect } from './side';
export { sideNormal, oppositeSide, autoSides, sideMidpoint } from './side';
export type { EndpointGeom, EdgePathInput, CubicSegment, EdgeShape, EdgePathFn } from './edge-path';
export {
  straightPath,
  bezierPath,
  orthogonalPath,
  drawEdgeShape,
  edgeShapeDistance,
  edgeShapeMidpoint,
  edgeShapeTangents,
} from './edge-path';
export type { EdgeEndpoints, EdgeTypeDescriptor } from './edge-type';
export { EdgeTypeRegistry, BUILTIN_EDGE_TYPES } from './edge-type';
export type { EdgeRenderCtx, EdgeRenderer } from './edge-render';
export { resolveEdgeGeom, drawDefaultEdge, reciprocalPartner, isMergedAway } from './edge-render';
export type { BackgroundRenderer } from './background';
export { BUILTIN_BACKGROUNDS, gridBackground, dotsBackground, linesBackground, noneBackground } from './background';

export type { OpenGraphInfo } from './host';
export { GraphHost } from './host';

export type { GraphGeometry, GraphChrome } from './theme';
export { GraphTheme, DEFAULT_GEOMETRY, createGraphTheme, setTheme } from './theme';
export type { Interaction, Hover, GraphView } from './view';
export { createGraphView, worldToScreen, screenToWorld, zoomAt, panBy } from './view';
export type { PinLayout, FieldRowLayout, NodeLayout, GraphLayout, PickResult } from './layout-cache';
export { buildLayout, layoutNode, pinAnchor, pick } from './layout-cache';
export type { InteractionCtx } from './interaction';
export { updateInteraction } from './interaction';
export { drawGrid, drawScanlines, handleNavigation, fitBounds } from './canvas';
export { wireTangent, drawWire } from './wire';
export type { DrawNodeParams, NodeRenderer } from './node-render';
export { drawNode, drawStandardNode, pinKey, BUILTIN_NODE_RENDERERS } from './node-render';
export type { GraphDrawParams } from './graph-editor';
export { GraphEditor } from './graph-editor';
export { drawMinimap, drawStatus, minimapNavigate, minimapRect } from './overlays';
