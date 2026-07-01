/**
 * The `GraphEnvironment` owns the registries a set of graphs shares: a global
 * data-type registry and category registry (one color language across all
 * kinds) plus a map of {@link GraphKind}s (each with its own node-type
 * vocabulary). It is an instance, not a module singleton, so the studio and an
 * MCP host can each hold their own. It also resolves pins and validates
 * connections against a document's kind — the one place render, interaction, and
 * MCP all go through.
 */

import { BUILTIN_CATEGORIES, type CategoryDescriptor, CategoryRegistry } from './category';
import { BUILTIN_DATA_TYPES, type DataTypeDescriptor, DataTypeRegistry, type PinShape } from './data-type';
import type { GraphDocument, GraphEdge, PinRef } from './document';
import { GraphKind, type GraphKindOptions, type ResolvedPin } from './kind';

export class GraphEnvironment {
  readonly dataTypes = new DataTypeRegistry();
  readonly categories = new CategoryRegistry();
  private readonly kinds = new Map<string, GraphKind>();

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
    const pin = kind.nodeTypes.pin(node.typeId, ref.pin, dir);
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
