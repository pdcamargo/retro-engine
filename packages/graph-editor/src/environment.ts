/**
 * The `GraphEnvironment` owns the registries a set of graphs shares: a global
 * data-type registry and category registry (one color language across all
 * kinds) plus a map of {@link GraphKind}s (each with its own node-type
 * vocabulary). It is an instance, not a module singleton, so the studio and an
 * MCP host can each hold their own. It also resolves pins and validates
 * connections against a document's kind — the one place render, interaction, and
 * MCP all go through.
 */

import { type BackgroundRenderer, BUILTIN_BACKGROUNDS } from './background';
import { BUILTIN_CATEGORIES, type CategoryDescriptor, CategoryRegistry } from './category';
import { BUILTIN_DATA_TYPES, type DataTypeDescriptor, DataTypeRegistry, type PinShape } from './data-type';
import type { GraphDocument, GraphEdge, PinRef } from './document';
import { bezierPath, type EdgePathFn, orthogonalPath, straightPath } from './edge-path';
import { BUILTIN_EDGE_TYPES, type EdgeTypeDescriptor } from './edge-type';
import { GraphKind, type GraphKindOptions, type ResolvedPin } from './kind';
import { BUILTIN_NODE_RENDERERS, type NodeRenderer } from './node-render';

export class GraphEnvironment {
  readonly dataTypes = new DataTypeRegistry();
  readonly categories = new CategoryRegistry();
  private readonly kinds = new Map<string, GraphKind>();
  private readonly nodeRenderers = new Map<string, NodeRenderer>(Object.entries(BUILTIN_NODE_RENDERERS));
  private readonly backgrounds = new Map<string, BackgroundRenderer>(Object.entries(BUILTIN_BACKGROUNDS));
  private readonly edgePaths = new Map<string, EdgePathFn>([
    ['bezier', bezierPath],
    ['straight', straightPath],
    ['orthogonal', orthogonalPath],
  ]);
  private readonly builtinEdgeTypes = new Map<string, EdgeTypeDescriptor>(BUILTIN_EDGE_TYPES.map((d) => [d.type, d]));

  /** Register (or replace) a data type. Extends the shared pin/wire color set. */
  registerType(desc: { name: string; color: string; shape?: PinShape }): this {
    this.dataTypes.register(desc);
    return this;
  }

  /** Register (or replace) a node category. Extends the shared header accent set. */
  registerCategory(desc: CategoryDescriptor): this {
    this.categories.register(desc);
    return this;
  }

  /** Register a graph kind and return it (register its node types on `.nodeTypes`). */
  registerKind(opts: GraphKindOptions): GraphKind {
    const kind = new GraphKind(opts);
    this.kinds.set(kind.id, kind);
    return kind;
  }

  /** Register (or replace) a node renderer for a node `style`. */
  registerNodeRenderer(style: string, render: NodeRenderer): this {
    this.nodeRenderers.set(style, render);
    return this;
  }

  /** Register (or replace) a canvas background renderer under an id. */
  registerBackground(id: string, render: BackgroundRenderer): this {
    this.backgrounds.set(id, render);
    return this;
  }

  /** Register (or replace) an edge path (curve) strategy under an id. */
  registerEdgePath(id: string, path: EdgePathFn): this {
    this.edgePaths.set(id, path);
    return this;
  }

  /** The node renderer for a style, falling back to the standard node renderer. */
  nodeRenderer(style: string): NodeRenderer {
    return this.nodeRenderers.get(style) ?? this.nodeRenderers.get('node')!;
  }

  /** The background renderer for an id (default `grid`), falling back to the grid. */
  background(id = 'grid'): BackgroundRenderer {
    return this.backgrounds.get(id) ?? this.backgrounds.get('grid')!;
  }

  /** Resolve a path spec (a registered id or a function) to a path strategy; default `bezier`. */
  edgePath(path?: string | EdgePathFn): EdgePathFn {
    if (typeof path === 'function') return path;
    if (typeof path === 'string') return this.edgePaths.get(path) ?? bezierPath;
    return bezierPath;
  }

  /**
   * Resolve an edge type for a document: the kind's override first, then the
   * environment built-ins, then `default`. `styleId` is `GraphEdge.style`.
   */
  edgeType(kindId: string, styleId?: string): EdgeTypeDescriptor {
    const id = styleId ?? 'default';
    const kind = this.kinds.get(kindId);
    return (
      kind?.edgeTypes.get(id) ??
      this.builtinEdgeTypes.get(id) ??
      this.builtinEdgeTypes.get('default')!
    );
  }

  kind(id: string): GraphKind | undefined {
    return this.kinds.get(id);
  }

  kindList(): readonly GraphKind[] {
    return [...this.kinds.values()];
  }

  /** Resolve a pin reference against a document's kind + node type. */
  resolvePin(doc: GraphDocument, ref: PinRef, dir: 'in' | 'out'): ResolvedPin | undefined {
    const kind = this.kinds.get(doc.kindId);
    if (kind === undefined) return undefined;
    const node = doc.nodes[ref.node];
    if (node === undefined) return undefined;
    const nodeType = kind.nodeTypes.get(node.typeId);
    if (nodeType === undefined) return undefined;
    // Per-instance pin overrides take precedence over the type's static pins.
    const override = dir === 'in' ? node.inputs : node.outputs;
    const pin = override !== undefined ? override.find((p) => p.name === ref.pin) : kind.nodeTypes.pin(node.typeId, ref.pin, dir);
    if (pin === undefined) return undefined;
    return { node, nodeType, pin, dir };
  }

  /** The data type of a pin, or `undefined` if it can't be resolved. */
  pinDataType(doc: GraphDocument, ref: PinRef, dir: 'in' | 'out'): DataTypeDescriptor | undefined {
    const resolved = this.resolvePin(doc, ref, dir);
    if (resolved === undefined) return undefined;
    return this.dataTypes.get(resolved.pin.type);
  }

  /** An edge's data type — inherited from its source (output) pin. */
  edgeDataType(doc: GraphDocument, edge: GraphEdge): DataTypeDescriptor | undefined {
    return this.pinDataType(doc, edge.from, 'out');
  }

  /**
   * Whether an output pin (`from`) may connect to an input pin (`to`) in this
   * document. `false` if either pin fails to resolve or the kind's rule rejects.
   */
  canConnect(doc: GraphDocument, from: PinRef, to: PinRef): boolean {
    const kind = this.kinds.get(doc.kindId);
    if (kind === undefined) return false;
    const rf = this.resolvePin(doc, from, 'out');
    const rt = this.resolvePin(doc, to, 'in');
    if (rf === undefined || rt === undefined) return false;
    return kind.canConnect(rf, rt);
  }
}

/**
 * Create a graph environment. By default it is seeded with the built-in data
 * types and categories (the shared visual language); pass
 * `{ seedDefaults: false }` for a bare environment.
 */
export const createGraphEnvironment = (opts?: { seedDefaults?: boolean }): GraphEnvironment => {
  const env = new GraphEnvironment();
  if (opts?.seedDefaults !== false) {
    for (const dt of BUILTIN_DATA_TYPES) env.registerType(dt);
    for (const cat of BUILTIN_CATEGORIES) env.registerCategory(cat);
  }
  return env;
};
