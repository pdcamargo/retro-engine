import type { App, Stage } from './index';
import type { RenderSetName } from './render-set';
import type { Param, ResolveCtx, SystemId } from './system-param';
import type { RunCondition } from './system-param';

/**
 * Where a registered system came from, used to bucket systems for tooling.
 *
 * - `'engine'` — a system registered by an engine framework plugin (the core
 *   simulation, rendering, transforms, and so on).
 * - `'editor'` — a system registered by editor / tooling code that hosts the
 *   engine for authoring; not part of a shipped game.
 * - `'user'` — a gameplay system registered by application code.
 *
 * Resolved at registration: an explicit `origin` on the system's options wins,
 * otherwise the registering plugin's {@link PluginObject.category} is used,
 * otherwise `'user'`.
 */
export type SystemOrigin = 'engine' | 'editor' | 'user';

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
  /** Human-readable display name, resolved from `name` / `label` / `fn.name` / the system id. */
  readonly name: string;
  /** Origin bucket used by tooling to group systems. */
  readonly origin: SystemOrigin;
  /** Name of the plugin whose `build()` registered this system, or `null` when registered directly on the App. */
  readonly originPlugin: string | null;
  readonly runIf?: RunCondition;
  readonly label?: string;
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  /**
   * Render sub-set this system belongs to. Set only for `'render'`-stage
   * systems; ignored elsewhere. `undefined` on render-stage systems defaults
   * to {@link RenderSet.Render} at frame-loop time, preserving the
   * single-pass shape that predates ADR-0019.
   */
  readonly set?: RenderSetName;
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

  /**
   * Remove every system matching `pred` and return them. Invalidates the topo
   * cache so the next `ordered()` rebuilds without the removed systems. Used by
   * the live plugin swap (hot reload) to drop a reloaded plugin's systems from a
   * running schedule.
   */
  remove(pred: (sys: RegisteredSystem) => boolean): RegisteredSystem[] {
    const removed: RegisteredSystem[] = [];
    for (let i = this.systems.length - 1; i >= 0; i -= 1) {
      if (pred(this.systems[i]!)) removed.push(...this.systems.splice(i, 1));
    }
    if (removed.length > 0) this.cache = null;
    return removed;
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
  const profiling = app.systemProfilingEnabled;
  for (const sys of stageSystems.ordered()) {
    if (app.isSystemDisabled(sys.id)) continue;
    if (sys.runIf && !sys.runIf.test(app)) continue;
    const lastSeenTick = app.lastSeenTickOf(sys.id);
    const lastSeenFrame = app.lastSeenFrameOf(sys.id);
    const tickAtRunStart = app.world.changeTick;
    const frameAtRunStart = app.currentFrameNumber();
    const ctx: ResolveCtx = {
      app,
      world: app.world,
      stage,
      systemId: sys.id,
      lastSeenTick,
      lastSeenFrame,
    };
    const values = sys.params.map((p) => p.resolve(ctx));
    const t0 = profiling ? performance.now() : 0;
    try {
      sys.fn(...values);
    } catch (err) {
      app.discardSystemCommands(sys.id);
      throw err;
    }
    if (profiling) app.recordSystemTime(sys.id, performance.now() - t0);
    app.flushSystemCommands(sys.id, stage);
    app.recordSystemLastSeenTick(sys.id, tickAtRunStart);
    app.recordSystemLastSeenFrame(sys.id, frameAtRunStart);
  }
};
