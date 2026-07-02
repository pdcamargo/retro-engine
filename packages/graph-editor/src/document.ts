/**
 * The headless graph document model — pure data, no ImGui, no runtime coupling.
 *
 * A {@link GraphDocument} is the serializable state a consumer maps its own
 * runtime graph to/from. Collections are **id-keyed plain-object records** (not
 * `Map`s or arrays) so the editor's field-path machinery can address any nested
 * value (`nodes.<id>.pos`, …) for undoable edits. All positions are world-space.
 */

/** Stable identity of a node within a document. */
export type NodeId = string;
/** Stable identity of an edge within a document. */
export type EdgeId = string;
/** Stable identity of a reroute knot within a document. */
export type RerouteId = string;
/** Stable identity of a group container within a document. */
export type GroupId = string;

/** A world-space point `[x, y]`. Mutable and index-addressable for field edits. */
export type Point = [x: number, y: number];
/** A world-space rectangle `[x, y, w, h]`. */
export type Rect = [x: number, y: number, w: number, h: number];

import type { PinDescriptor } from './node-type';

/** Which header treatment a node draws with; see the node-type default. */
export type HeaderVariant = 'stripe' | 'solid' | 'tick';

/** A reference to one pin on one node: the node id plus the pin's declared name. */
export interface PinRef {
  readonly node: NodeId;
  /** The pin's `name` as declared on the node type's `inputs` / `outputs`. */
  readonly pin: string;
}

/** One placed node instance. Its shape/pins/fields are defined by its node type. */
export interface GraphNode {
  readonly id: NodeId;
  /** The registered node-type id (`NodeTypeDescriptor.type`) this instance renders as. */
  typeId: string;
  /** Top-left world position. */
  pos: Point;
  /** Explicit size override `[w, h]`; when absent the layout measures the node. */
  size?: [w: number, h: number];
  /** Collapsed to header-only when `true`. */
  collapsed?: boolean;
  /** Dimmed and non-interactive when `true`. */
  disabled?: boolean;
  /** An error message to surface on the node, or `null`/absent when healthy. */
  error?: string | null;
  /** Display title override; falls back to the node type's label. */
  title?: string;
  /** Header-variant override; falls back to the node type's default. */
  headerVariant?: HeaderVariant;
  /**
   * Per-instance pin overrides. When present they replace the node type's static
   * pins — for nodes whose ports are data-driven (a blend-tree root grows one
   * output row per child). Absent = use the type's declared pins.
   */
  inputs?: readonly PinDescriptor[];
  outputs?: readonly PinDescriptor[];
  /** Current values of the node's embedded fields, keyed by field name. */
  fieldValues: Record<string, unknown>;
}

/** A directed connection from an output pin to an input pin, optionally rerouted. */
export interface GraphEdge {
  readonly id: EdgeId;
  /** The source (output) pin. The edge's data type is derived from this pin. */
  from: PinRef;
  /** The target (input) pin. */
  to: PinRef;
  /** Ordered reroute-knot ids the wire threads through, source→target. */
  via: RerouteId[];
  /**
   * Edge-type id selecting how the wire attaches and draws (see the environment's
   * edge-type registry). `'transition'` is the built-in state-machine arrow;
   * omitted = the built-in `'default'` typed data/exec wire between pins.
   */
  style?: string;
  /** Optional short glyph/label shown on an edge's midpoint badge. */
  label?: string;
}

/** A draggable "weight point" an edge threads through to organize its routing. */
export interface GraphReroute {
  readonly id: RerouteId;
  /** The edge this knot belongs to. */
  edge: EdgeId;
  /** World position of the knot. */
  pos: Point;
}

/** A dashed container drawn behind member nodes, purely organizational. */
export interface GraphGroup {
  readonly id: GroupId;
  /** World rectangle the group covers. */
  rect: Rect;
  title: string;
  /** Category id driving the group's accent color. */
  categoryId?: string;
}

/** Monotonic per-collection counters so minted ids never collide, even after deletes. */
export interface GraphCounters {
  node: number;
  edge: number;
  reroute: number;
  group: number;
}

/** A complete, serializable node-graph document. */
export interface GraphDocument {
  /** Stable document identity (asset GUID). */
  readonly guid: string;
  /** The {@link GraphKind} id this document is authored against. */
  kindId: string;
  nodes: Record<NodeId, GraphNode>;
  edges: Record<EdgeId, GraphEdge>;
  reroutes: Record<RerouteId, GraphReroute>;
  groups: Record<GroupId, GraphGroup>;
  /** Node ids in back-to-front draw order; last drawn is topmost. */
  nodeOrder: NodeId[];
  counters: GraphCounters;
}

const newGuid = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Deterministic-enough fallback for environments without WebCrypto.
  return `graph-${Date.now().toString(36)}`;
};

/** Create an empty document for a given graph kind. Pass `guid` to pin its identity. */
export const createGraphDocument = (opts: { kindId: string; guid?: string }): GraphDocument => ({
  guid: opts.guid ?? newGuid(),
  kindId: opts.kindId,
  nodes: {},
  edges: {},
  reroutes: {},
  groups: {},
  nodeOrder: [],
  counters: { node: 0, edge: 0, reroute: 0, group: 0 },
});

/** Mint the next unique id for a collection, advancing its counter. */
export const mintId = (doc: GraphDocument, kind: keyof GraphCounters): string => {
  const n = ++doc.counters[kind];
  return `${kind[0]}${n}`;
};
