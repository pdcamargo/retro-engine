/**
 * Versioned JSON (de)serialization for {@link GraphDocument}. The document is
 * already plain, JSON-safe data (id-keyed records of plain objects and arrays),
 * so serialization is a version envelope plus structural validation on decode.
 * Mirrors the engine's `AssetSerializer` shape: `Uint8Array` in, `Uint8Array` out.
 */

import {
  type GraphCounters,
  type GraphDocument,
  type GraphEdge,
  type GraphGroup,
  type GraphNode,
  type GraphReroute,
} from './document';

/** Current on-disk format version. Bump when the wire shape changes; add a migration. */
export const GRAPH_FORMAT_VERSION = 1;

interface GraphFile {
  readonly version: number;
  readonly guid: string;
  readonly kindId: string;
  readonly nodes: Record<string, GraphNode>;
  readonly edges: Record<string, GraphEdge>;
  readonly reroutes: Record<string, GraphReroute>;
  readonly groups: Record<string, GraphGroup>;
  readonly nodeOrder: readonly string[];
  readonly counters: GraphCounters;
}

/** Serialize a document to a version-tagged JSON byte payload. */
export const serializeGraph = (doc: GraphDocument): Uint8Array => {
  const file: GraphFile = {
    version: GRAPH_FORMAT_VERSION,
    guid: doc.guid,
    kindId: doc.kindId,
    nodes: doc.nodes,
    edges: doc.edges,
    reroutes: doc.reroutes,
    groups: doc.groups,
    nodeOrder: doc.nodeOrder,
    counters: doc.counters,
  };
  return new TextEncoder().encode(JSON.stringify(file));
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Decode a document from a byte payload produced by {@link serializeGraph}.
 * Throws on a malformed payload or an unknown version. Rebuilds `counters` and
 * `nodeOrder` defensively when a hand-authored file omits them.
 */
export const deserializeGraph = (bytes: Uint8Array): GraphDocument => {
  const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isRecord(raw)) throw new Error('graph: payload is not an object');
  const version = raw.version;
  if (version !== GRAPH_FORMAT_VERSION) {
    throw new Error(`graph: unsupported format version ${String(version)} (expected ${GRAPH_FORMAT_VERSION})`);
  }
  if (typeof raw.guid !== 'string' || typeof raw.kindId !== 'string') {
    throw new Error('graph: payload missing guid/kindId');
  }
  const nodes = isRecord(raw.nodes) ? (raw.nodes as Record<string, GraphNode>) : {};
  const edges = isRecord(raw.edges) ? (raw.edges as Record<string, GraphEdge>) : {};
  const reroutes = isRecord(raw.reroutes) ? (raw.reroutes as Record<string, GraphReroute>) : {};
  const groups = isRecord(raw.groups) ? (raw.groups as Record<string, GraphGroup>) : {};
  const nodeOrder = Array.isArray(raw.nodeOrder)
    ? (raw.nodeOrder as string[]).filter((id) => nodes[id] !== undefined)
    : Object.keys(nodes);
  // Any node not listed in nodeOrder is appended so nothing is silently dropped.
  for (const id of Object.keys(nodes)) if (!nodeOrder.includes(id)) nodeOrder.push(id);
  const counters = isRecord(raw.counters)
    ? (raw.counters as unknown as GraphCounters)
    : rebuildCounters(nodes, edges, reroutes, groups);
  return { guid: raw.guid, kindId: raw.kindId, nodes, edges, reroutes, groups, nodeOrder, counters };
};

/** Derive counters from existing ids so freshly minted ids won't collide. */
const rebuildCounters = (
  nodes: Record<string, unknown>,
  edges: Record<string, unknown>,
  reroutes: Record<string, unknown>,
  groups: Record<string, unknown>,
): GraphCounters => {
  const maxSuffix = (keys: string[]): number =>
    keys.reduce((m, k) => Math.max(m, Number.parseInt(k.slice(1), 10) || 0), 0);
  return {
    node: maxSuffix(Object.keys(nodes)),
    edge: maxSuffix(Object.keys(edges)),
    reroute: maxSuffix(Object.keys(reroutes)),
    group: maxSuffix(Object.keys(groups)),
  };
};
