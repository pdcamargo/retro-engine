import type { Node, NodeRunContext } from './node';
import type { RenderLabel } from './render-label';

/**
 * A flat, named collection of {@link Node}s with ordering edges between them.
 *
 * One sub-graph runs per active camera inside the {@link CameraDriverNode}.
 * Cameras pick which sub-graph drives them via `Camera.subGraph` — `Core2d`
 * or `Core3d` ship as built-in templates, and plugins register their own.
 *
 * A sub-graph is mutable until the owning {@link RenderGraph} is frozen
 * (which happens at the start of the first {@link App.renderFrame} call after
 * the plugin lifecycle reaches `Cleaned`). After freeze, all mutating
 * methods throw — plugins must register nodes and edges during their `build`
 * or `finish` callbacks.
 *
 * The graph is intentionally flat: a sub-graph cannot contain another
 * sub-graph. The only nesting in the system is `RenderGraph → CameraDriverNode
 * → sub-graph`.
 */
export class RenderSubGraph {
  /** Sub-graph identity. Stored alongside the registration in {@link RenderGraph}. */
  readonly label: RenderLabel;
  private readonly nodes = new Map<RenderLabel, Node>();
  private readonly outgoing = new Map<RenderLabel, Set<RenderLabel>>();
  private readonly incoming = new Map<RenderLabel, Set<RenderLabel>>();
  private cachedOrder: Node[] | undefined;

  constructor(label: RenderLabel) {
    this.label = label;
  }

  /**
   * Add a node. Throws on duplicate label or after freeze. The node's
   * insertion order is preserved as a tiebreaker for the topological sort, so
   * adding nodes in a stable order produces a stable execution order.
   */
  addNode(node: Node): void {
    this.ensureMutable();
    if (this.nodes.has(node.label)) {
      throw new Error(
        `RenderSubGraph(${this.label}): duplicate node label ${String(node.label)}.`,
      );
    }
    this.nodes.set(node.label, node);
    this.outgoing.set(node.label, new Set());
    this.incoming.set(node.label, new Set());
  }

  /**
   * Order `before` to run before `after`. Both labels must already be
   * registered as nodes on this sub-graph. Re-adding the same edge is a
   * no-op; conflicting edges raise on freeze.
   */
  addEdge(before: RenderLabel, after: RenderLabel): void {
    this.ensureMutable();
    if (!this.nodes.has(before)) {
      throw new Error(
        `RenderSubGraph(${this.label}): edge endpoint not registered: ${String(before)}.`,
      );
    }
    if (!this.nodes.has(after)) {
      throw new Error(
        `RenderSubGraph(${this.label}): edge endpoint not registered: ${String(after)}.`,
      );
    }
    if (before === after) {
      throw new Error(
        `RenderSubGraph(${this.label}): edge would be a self-loop on ${String(before)}.`,
      );
    }
    this.outgoing.get(before)!.add(after);
    this.incoming.get(after)!.add(before);
  }

  /** True after {@link freeze}; mutating methods throw past this point. */
  get frozen(): boolean {
    return this.cachedOrder !== undefined;
  }

  /**
   * Run Kahn's algorithm over the nodes and edges, cache the result, and
   * lock the sub-graph against further mutation. Idempotent. Throws on
   * cycle.
   */
  freeze(): void {
    if (this.cachedOrder !== undefined) return;
    const inDegree = new Map<RenderLabel, number>();
    for (const label of this.nodes.keys()) {
      inDegree.set(label, this.incoming.get(label)!.size);
    }
    const queue: RenderLabel[] = [];
    for (const [label, deg] of inDegree) {
      if (deg === 0) queue.push(label);
    }
    const ordered: Node[] = [];
    while (queue.length > 0) {
      const label = queue.shift()!;
      ordered.push(this.nodes.get(label)!);
      for (const next of this.outgoing.get(label)!) {
        const deg = inDegree.get(next)! - 1;
        inDegree.set(next, deg);
        if (deg === 0) queue.push(next);
      }
    }
    if (ordered.length < this.nodes.size) {
      const unresolved: string[] = [];
      for (const [label, deg] of inDegree) {
        if (deg > 0) unresolved.push(String(label));
      }
      throw new Error(
        `RenderSubGraph(${this.label}): cycle detected involving nodes [${unresolved.join(', ')}].`,
      );
    }
    this.cachedOrder = ordered;
  }

  /** Execute every node in topological order against the supplied context. */
  run(ctx: NodeRunContext): void {
    if (this.cachedOrder === undefined) {
      throw new Error(
        `RenderSubGraph(${this.label}): run() called before freeze(); call RenderGraph.freeze() first.`,
      );
    }
    for (const node of this.cachedOrder) {
      node.run(ctx);
    }
  }

  /**
   * Snapshot of the resolved execution order. Returns `undefined` before
   * freeze. Intended for diagnostics and the future studio visualiser
   * (roadmap §5.8); production code should call {@link run}.
   */
  orderedNodes(): readonly Node[] | undefined {
    return this.cachedOrder;
  }

  private ensureMutable(): void {
    if (this.cachedOrder !== undefined) {
      throw new Error(
        `RenderSubGraph(${this.label}): graph is frozen; register nodes and edges before the first frame.`,
      );
    }
  }
}
