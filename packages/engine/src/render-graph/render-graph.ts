import type { Node, NodeRunContext } from './node';
import type { RenderLabel } from './render-label';
import { RenderSubGraph } from './sub-graph';

/**
 * Engine-wide render graph: a small set of top-level {@link Node}s plus a
 * registry of {@link RenderSubGraph}s that those nodes dispatch into.
 *
 * Today the only top-level node is the `CameraDriverNode` registered by
 * `RenderGraphPlugin`; sub-graphs are `Core2d` and `Core3d`. Plugins may
 * register additional sub-graphs (and, rarely, additional top-level nodes)
 * during their `build` / `finish` callbacks.
 *
 * The graph is mutable until {@link freeze} runs at the start of the first
 * `App.renderFrame` call after the plugin lifecycle reaches `Cleaned`; past
 * that point, every mutating method throws.
 *
 * Inserted as a render-world resource by `RenderGraphPlugin`. Read it via
 * `App.getResource(RenderGraph)`.
 */
export class RenderGraph {
  private readonly nodes = new Map<RenderLabel, Node>();
  private readonly outgoing = new Map<RenderLabel, Set<RenderLabel>>();
  private readonly incoming = new Map<RenderLabel, Set<RenderLabel>>();
  private readonly subGraphs = new Map<RenderLabel, RenderSubGraph>();
  private cachedOrder: Node[] | undefined;

  /** Register a top-level node. Throws on duplicate label or after freeze. */
  addNode(node: Node): void {
    this.ensureMutable();
    if (this.nodes.has(node.label)) {
      throw new Error(`RenderGraph: duplicate node label ${String(node.label)}.`);
    }
    this.nodes.set(node.label, node);
    this.outgoing.set(node.label, new Set());
    this.incoming.set(node.label, new Set());
  }

  /** Order one top-level node before another. Both must already be registered. */
  addEdge(before: RenderLabel, after: RenderLabel): void {
    this.ensureMutable();
    if (!this.nodes.has(before)) {
      throw new Error(`RenderGraph: edge endpoint not registered: ${String(before)}.`);
    }
    if (!this.nodes.has(after)) {
      throw new Error(`RenderGraph: edge endpoint not registered: ${String(after)}.`);
    }
    if (before === after) {
      throw new Error(`RenderGraph: edge would be a self-loop on ${String(before)}.`);
    }
    this.outgoing.get(before)!.add(after);
    this.incoming.get(after)!.add(before);
  }

  /**
   * Register a sub-graph under its own label. Throws on duplicate label or
   * after freeze. Plugins build the sub-graph (adding nodes and edges to it)
   * before passing it here.
   */
  addSubGraph(subGraph: RenderSubGraph): void {
    this.ensureMutable();
    if (this.subGraphs.has(subGraph.label)) {
      throw new Error(`RenderGraph: duplicate sub-graph label ${String(subGraph.label)}.`);
    }
    this.subGraphs.set(subGraph.label, subGraph);
  }

  /** Look up a previously-registered sub-graph by its label. */
  getSubGraph(label: RenderLabel): RenderSubGraph | undefined {
    return this.subGraphs.get(label);
  }

  /** True after {@link freeze}; mutating methods throw past this point. */
  get frozen(): boolean {
    return this.cachedOrder !== undefined;
  }

  /**
   * Topologically sort the top-level nodes and every registered sub-graph,
   * cache the result, and lock further mutation. Idempotent. Throws on cycle
   * (either at the top level or inside any sub-graph).
   */
  freeze(): void {
    if (this.cachedOrder !== undefined) return;
    this.cachedOrder = topoSort(this.nodes, this.incoming, this.outgoing, 'top-level');
    for (const sub of this.subGraphs.values()) {
      sub.freeze();
    }
  }

  /**
   * Execute every top-level node in topological order. The supplied context's
   * `encoder` / `pass` / `view` fields are expected to be `undefined` at the
   * top level — nodes that own those resources (the `CameraDriverNode` and the
   * sub-graph pass nodes) set them on the contexts they pass down.
   */
  run(ctx: NodeRunContext): void {
    if (this.cachedOrder === undefined) {
      throw new Error('RenderGraph: run() called before freeze().');
    }
    for (const node of this.cachedOrder) {
      node.run(ctx);
    }
  }

  /**
   * Dispatch a named sub-graph. Used by node implementations (typically
   * `CameraDriverNode`) to forward execution into a camera's sub-graph.
   * Throws if no sub-graph is registered under `label`.
   */
  runSubGraph(label: RenderLabel, ctx: NodeRunContext): void {
    const sub = this.subGraphs.get(label);
    if (sub === undefined) {
      throw new Error(`RenderGraph: no sub-graph registered under label ${String(label)}.`);
    }
    sub.run(ctx);
  }

  /**
   * Snapshot of resolved top-level execution order. `undefined` before freeze.
   * Intended for diagnostics and the future studio visualiser; production
   * code should call {@link run}.
   */
  orderedNodes(): readonly Node[] | undefined {
    return this.cachedOrder;
  }

  private ensureMutable(): void {
    if (this.cachedOrder !== undefined) {
      throw new Error(
        'RenderGraph: graph is frozen; register nodes and sub-graphs before the first frame.',
      );
    }
  }
}

/**
 * Kahn's-algorithm topological sort shared by {@link RenderGraph} and
 * {@link RenderSubGraph}. Returns the nodes in run order or throws on cycle.
 * Iteration over `nodes` (a `Map`) preserves insertion order, so the result
 * is deterministic for the same input.
 */
function topoSort(
  nodes: ReadonlyMap<RenderLabel, Node>,
  incoming: ReadonlyMap<RenderLabel, ReadonlySet<RenderLabel>>,
  outgoing: ReadonlyMap<RenderLabel, ReadonlySet<RenderLabel>>,
  scope: string,
): Node[] {
  const inDegree = new Map<RenderLabel, number>();
  for (const label of nodes.keys()) {
    inDegree.set(label, incoming.get(label)!.size);
  }
  const queue: RenderLabel[] = [];
  for (const [label, deg] of inDegree) {
    if (deg === 0) queue.push(label);
  }
  const ordered: Node[] = [];
  while (queue.length > 0) {
    const label = queue.shift()!;
    ordered.push(nodes.get(label)!);
    for (const next of outgoing.get(label)!) {
      const deg = inDegree.get(next)! - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  if (ordered.length < nodes.size) {
    const unresolved: string[] = [];
    for (const [label, deg] of inDegree) {
      if (deg > 0) unresolved.push(String(label));
    }
    throw new Error(`RenderGraph(${scope}): cycle detected involving nodes [${unresolved.join(', ')}].`);
  }
  return ordered;
}
