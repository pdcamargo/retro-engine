import type { App, Stage } from './index';
import type { Param, ResolveCtx, SystemId } from './system-param';
import type { RunCondition } from './system-param';

/**
 * Internal record for a system registered against a stage. Holds the
 * resolved-by-name ordering metadata (`label`, `before`, `after`) alongside the
 * params, function, and per-system identity used by the runner.
 *
 * Not part of the public API — produced by `App.addSystem` and consumed by the
 * stage runner. Future param kinds (e.g. `Commands`, `Local<T>`) keyed by
 * {@link SystemId} attach their per-system state from this record.
 */
export interface RegisteredSystem {
  readonly id: SystemId;
  readonly params: ReadonlyArray<Param<unknown>>;
  readonly fn: (...args: unknown[]) => void;
  readonly runIf?: RunCondition;
  readonly label?: string;
  readonly before?: readonly string[];
  readonly after?: readonly string[];
}

/**
 * Per-stage system collection plus a memoised topological order. Mutating the
 * collection invalidates the cache; the runner rebuilds via {@link topoSort}
 * on next access.
 *
 * `push` runs the topo sort eagerly so a constraint cycle is reported at the
 * call site that introduced it, not delayed until the stage next runs. A
 * cycle rolls the offending registration back before re-throwing.
 */
export class StageSystems {
  readonly systems: RegisteredSystem[] = [];
  private cache: RegisteredSystem[] | null = null;

  push(sys: RegisteredSystem): void {
    this.systems.push(sys);
    this.cache = null;
    try {
      this.cache = topoSort(this.systems);
    } catch (err) {
      this.systems.pop();
      this.cache = null;
      throw err;
    }
  }

  ordered(): readonly RegisteredSystem[] {
    if (this.cache === null) this.cache = topoSort(this.systems);
    return this.cache;
  }

  /** Force re-sort on next access. Called when a label referenced elsewhere is registered. */
  invalidate(): void {
    this.cache = null;
  }

  get length(): number {
    return this.systems.length;
  }
}

/**
 * Kahn's-algorithm topological sort over the given systems.
 *
 * Edges:
 * - `A.before = ['L']` → A must run before every system with `label === 'L'`
 *   (edge A → each L-labelled system).
 * - `A.after  = ['L']` → A must run after every system with `label === 'L'`
 *   (edge each L-labelled system → A).
 *
 * Labels referenced but not present in the input are silently ignored
 * (forward references resolve when the labelled system registers later).
 * Tie-break is registration order: among nodes with zero remaining in-degree,
 * the earliest-registered runs first.
 *
 * Throws `Error` if a cycle exists. The message names the labels (or
 * registration positions) of the systems left in the cycle.
 */
export const topoSort = (
  systems: readonly RegisteredSystem[],
): RegisteredSystem[] => {
  const n = systems.length;
  if (n === 0) return [];

  const byLabel = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const s = systems[i]!;
    const lbl = s.label;
    if (lbl !== undefined) {
      const arr = byLabel.get(lbl);
      if (arr) arr.push(i);
      else byLabel.set(lbl, [i]);
    }
  }

  const adj: number[][] = Array.from({ length: n }, () => []);
  const inDeg: number[] = Array.from({ length: n }, () => 0);

  const addEdge = (from: number, to: number): void => {
    adj[from]!.push(to);
    inDeg[to] = inDeg[to]! + 1;
  };

  for (let i = 0; i < n; i++) {
    const s = systems[i]!;
    if (s.before) {
      for (const lbl of s.before) {
        const targets = byLabel.get(lbl);
        if (!targets) continue;
        for (const t of targets) {
          if (t !== i) addEdge(i, t);
        }
      }
    }
    if (s.after) {
      for (const lbl of s.after) {
        const sources = byLabel.get(lbl);
        if (!sources) continue;
        for (const u of sources) {
          if (u !== i) addEdge(u, i);
        }
      }
    }
  }

  // Registration-order FIFO over nodes with zero in-degree.
  const ready: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDeg[i] === 0) ready.push(i);
  }

  const out: RegisteredSystem[] = [];
  let head = 0;
  while (head < ready.length) {
    const u = ready[head++]!;
    out.push(systems[u]!);
    for (const v of adj[u]!) {
      inDeg[v] = inDeg[v]! - 1;
      if (inDeg[v] === 0) ready.push(v);
    }
  }

  if (out.length !== n) {
    const cycle: string[] = [];
    for (let i = 0; i < n; i++) {
      if (inDeg[i]! > 0) cycle.push(systems[i]!.label ?? `<system #${i}>`);
    }
    throw new Error(
      `App.addSystem: ordering cycle in before/after constraints — involves: ${cycle.join(', ')}`,
    );
  }

  return out;
};

/**
 * Run every system registered against a stage, in topological order, applying
 * each system's `runIf` gate. The runner is single-threaded and synchronous;
 * any thrown error propagates up.
 *
 * `render` stage is **not** driven by this function — the renderer needs a
 * `RenderContext` to attach to `ResolveCtx`. The render-stage entry point
 * lives on `App.renderFrame` and uses the same {@link RegisteredSystem.runIf}
 * gate and topo ordering via {@link StageSystems.ordered}.
 */
export const runStage = (stageSystems: StageSystems, app: App, stage: Stage): void => {
  if (stageSystems.length === 0) return;
  for (const sys of stageSystems.ordered()) {
    if (sys.runIf && !sys.runIf.test(app)) continue;
    const ctx: ResolveCtx = {
      app,
      world: app.world,
      stage,
      systemId: sys.id,
    };
    const values = sys.params.map((p) => p.resolve(ctx));
    try {
      sys.fn(...values);
    } catch (err) {
      app.discardSystemCommands(sys.id);
      throw err;
    }
    app.flushSystemCommands(sys.id);
  }
};
