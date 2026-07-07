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
   * Instance-level ordering edges keyed by {@link SystemId}: this system runs
   * after every listed system present in the same stage. Distinct from
   * label-keyed `after` — used by `App.addSystems({ chain: true })` to sequence
   * a batch by identity without touching each system's `label`. Ids absent from
   * the stage are ignored (same forgiving semantics as unmatched labels).
   */
  readonly afterIds?: readonly SystemId[];
  /**
   * Named sets this system belongs to. A set is a reusable ordering handle —
   * unlike `label` (one per system), a system can join several. `before` /
   * `after` can target a set name, and set-level ordering configured through
   * `App.configureSet` applies to every member. Stage-local, like labels.
   */
  readonly sets?: readonly string[];
  /**
   * Render sub-set this system belongs to. Set only for `'render'`-stage
   * systems; ignored elsewhere. `undefined` on render-stage systems defaults
   * to {@link RenderSet.Render} at frame-loop time, preserving the
   * single-pass shape that predates ADR-0019.
   */
  readonly set?: RenderSetName;
}

/**
 * Set-level configuration applied through `App.configureSet`, inherited by every
 * member of the set. Merged additively across repeated configuration of the same
 * set.
 *
 * - `before` / `after` — ordering: name other sets or labels in the same stage.
 * - `runIf` — a run condition gating the whole group: a member runs only if its
 *   own `runIf` (if any) **and** every set it belongs to pass. AND-ed across
 *   multiple conditions on the same set.
 */
export interface SetOrdering {
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  readonly runIf?: RunCondition;
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
  /** Set-level ordering for this stage, keyed by set name. Fed into every topo sort. */
  private readonly setOrdering = new Map<string, SetOrdering>();
  /** Set-level run conditions for this stage, keyed by set name (AND-ed per set). */
  private readonly setRunConditions = new Map<string, RunCondition[]>();

  push(sys: RegisteredSystem): void {
    this.systems.push(sys);
    this.cache = null;
    try {
      this.cache = topoSort(this.systems, this.setOrdering);
    } catch (err) {
      this.systems.pop();
      this.cache = null;
      throw err;
    }
  }

  /**
   * Add set-level config for `name` (merged additively with any prior config for
   * the same set). Ordering (`before` / `after`) re-sorts eagerly so a resulting
   * cycle is reported at the `configureSet` call site and rolled back; a
   * `runIf` is appended to the set's gate (run conditions don't affect ordering).
   */
  configureSet(name: string, ordering: SetOrdering): void {
    if (ordering.runIf !== undefined) {
      const conds = this.setRunConditions.get(name);
      if (conds) conds.push(ordering.runIf);
      else this.setRunConditions.set(name, [ordering.runIf]);
    }
    if (ordering.before === undefined && ordering.after === undefined) return;
    const prev = this.setOrdering.get(name);
    const merged: SetOrdering = {
      before: [...(prev?.before ?? []), ...(ordering.before ?? [])],
      after: [...(prev?.after ?? []), ...(ordering.after ?? [])],
    };
    this.setOrdering.set(name, merged);
    this.cache = null;
    try {
      this.cache = topoSort(this.systems, this.setOrdering);
    } catch (err) {
      if (prev === undefined) this.setOrdering.delete(name);
      else this.setOrdering.set(name, prev);
      this.cache = null;
      throw err;
    }
  }

  ordered(): readonly RegisteredSystem[] {
    if (this.cache === null) this.cache = topoSort(this.systems, this.setOrdering);
    return this.cache;
  }

  /**
   * Whether every set-level run condition for `sys`'s set memberships passes
   * against `app` this tick. `true` when the system joined no sets or the sets
   * carry no conditions. Alloc-free on the hot path (no array built). The
   * system's own `runIf` is checked separately by the runner.
   */
  setConditionsPass(sys: RegisteredSystem, app: App): boolean {
    if (sys.sets === undefined) return true;
    for (const setName of sys.sets) {
      const conds = this.setRunConditions.get(setName);
      if (conds === undefined) continue;
      for (const cond of conds) {
        if (!cond.test(app)) return false;
      }
    }
    return true;
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
 * A "name" is a system's `label` or any of its set memberships (`sets`), so a
 * `before` / `after` target matches both labelled systems and set members.
 *
 * Edges:
 * - `A.before = ['N']` → A must run before every system named `N`
 *   (edge A → each N-named system).
 * - `A.after  = ['N']` → A must run after every system named `N`
 *   (edge each N-named system → A).
 * - `A.afterIds = [id]` → A must run after the system with that id, if present
 *   (edge that-system → A). Used for identity-based chaining.
 * - `setOrdering.get('S') = { before: ['N'] }` → every member of set `S` runs
 *   before every system named `N` (and symmetrically for `after`).
 *
 * Names (or ids) referenced but not present in the input are silently ignored
 * (forward references resolve when the named system registers later).
 * Tie-break is registration order: among nodes with zero remaining in-degree,
 * the earliest-registered runs first.
 *
 * Throws `Error` if a cycle exists. The message names the labels (or
 * registration positions) of the systems left in the cycle.
 */
export const topoSort = (
  systems: readonly RegisteredSystem[],
  setOrdering?: ReadonlyMap<string, SetOrdering>,
): RegisteredSystem[] => {
  const n = systems.length;
  if (n === 0) return [];

  const byName = new Map<string, number[]>();
  const byId = new Map<SystemId, number>();
  const pushName = (name: string, i: number): void => {
    const arr = byName.get(name);
    if (arr) arr.push(i);
    else byName.set(name, [i]);
  };
  for (let i = 0; i < n; i++) {
    const s = systems[i]!;
    byId.set(s.id, i);
    if (s.label !== undefined) pushName(s.label, i);
    if (s.sets) for (const setName of s.sets) pushName(setName, i);
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
      for (const name of s.before) {
        const targets = byName.get(name);
        if (!targets) continue;
        for (const t of targets) {
          if (t !== i) addEdge(i, t);
        }
      }
    }
    if (s.after) {
      for (const name of s.after) {
        const sources = byName.get(name);
        if (!sources) continue;
        for (const u of sources) {
          if (u !== i) addEdge(u, i);
        }
      }
    }
    if (s.afterIds) {
      for (const id of s.afterIds) {
        const u = byId.get(id);
        if (u !== undefined && u !== i) addEdge(u, i);
      }
    }
  }

  // Set-level ordering: expand each configured set's before/after into edges on
  // every member of that set.
  if (setOrdering) {
    for (const [setName, ord] of setOrdering) {
      const members = byName.get(setName);
      if (!members) continue;
      if (ord.before) {
        for (const name of ord.before) {
          const targets = byName.get(name);
          if (!targets) continue;
          for (const m of members) for (const t of targets) if (m !== t) addEdge(m, t);
        }
      }
      if (ord.after) {
        for (const name of ord.after) {
          const sources = byName.get(name);
          if (!sources) continue;
          for (const m of members) for (const u of sources) if (u !== m) addEdge(u, m);
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
    if (!stageSystems.setConditionsPass(sys, app)) continue;
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
