import type { App, Stage } from './index';
import type { Param, ParamValues, ResolveCtx, SystemId } from './system-param';
import type { RunCondition } from './system-param';

/**
 * Per-type identity is recovered through the user's state class constructor
 * (`GameState`, `MenuState`, ...). State values are instances of that class.
 * Internally we cache **one minted resource class per state-type constructor**
 * for `State<S>` and `NextState<S>` so the existing constructor-identity
 * resource registry keys each state type to a distinct slot.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctor<T> = new (...args: any[]) => T;

const stateClassCache = new WeakMap<Ctor<object>, Ctor<unknown>>();
const nextStateClassCache = new WeakMap<Ctor<object>, Ctor<unknown>>();

/**
 * Live current value of a state type `S`. Read via `Res(State(GameState))`.
 *
 * `current` is `undefined` before the first transition fires (between
 * `initState` and the first `StateTransition` phase, which fires the initial
 * `OnEnter`). After the initial transition, `current` is always a value of
 * type `S` — set by the engine immediately before `OnTransition` systems
 * (and therefore before `OnEnter`) run. Gameplay code should treat `current`
 * as `S | undefined` and handle the pre-first-transition case.
 */
export interface StateInstance<S extends object> {
  current: S | undefined;
}

/**
 * Pending value of state type `S` queued for the next `StateTransition` phase.
 * Read via `ResMut(NextState(GameState))` to call `.set(value)` from a system;
 * the engine applies the transition and clears the slot back to `undefined`.
 *
 * Multiple `.set()` calls in one frame coalesce: only the final value is read
 * at `StateTransition`. Setting to the **same** value as `State.current` still
 * fires a full `OnExit → OnTransition → OnEnter` cycle (identity transitions
 * are intentional, useful for reset flows).
 */
export interface NextStateInstance<S extends object> {
  value: S | undefined;
  set(value: S): void;
  clear(): void;
}

/**
 * Return the minted resource class that backs `State<S>` for the given state
 * type. The factory is type-keyed: `State(GameState) === State(GameState)`,
 * and `State(GameState) !== State(MenuState)`. Use as the token in
 * `Res(State(GameState))` / `ResMut(State(GameState))`.
 *
 * The minted class has a single `current` field (initially `undefined`) and
 * is registered as a resource by `App.initState`.
 *
 * @example
 * ```ts
 * class GameState {
 *   static readonly Boot    = new GameState('Boot');
 *   static readonly Playing = new GameState('Playing');
 *   constructor(public readonly name: string) {}
 * }
 * app.initState(GameState, GameState.Boot);
 * app.addSystem('update', [Res(State(GameState))], (s) => {
 *   if (s.current === GameState.Playing) { ... }
 * });
 * ```
 */
export function State<S extends object>(ctor: Ctor<S>): Ctor<StateInstance<S>> {
  const cached = stateClassCache.get(ctor);
  if (cached) return cached as Ctor<StateInstance<S>>;
  const cls = class {
    current: S | undefined = undefined;
  } as Ctor<StateInstance<S>>;
  Object.defineProperty(cls, 'name', { value: `State<${ctor.name || '<anonymous>'}>` });
  stateClassCache.set(ctor, cls);
  return cls;
}

/**
 * Return the minted resource class that backs `NextState<S>`. Same identity
 * model as {@link State} — type-keyed via a `WeakMap`. Use as the token in
 * `Res(NextState(GameState))` / `ResMut(NextState(GameState))`.
 *
 * The minted class exposes `value: S | undefined`, `set(v)`, and `clear()`.
 * `App.initState` seeds `value = initial` so the first `StateTransition`
 * fires `OnEnter(initial)`.
 */
export function NextState<S extends object>(ctor: Ctor<S>): Ctor<NextStateInstance<S>> {
  const cached = nextStateClassCache.get(ctor);
  if (cached) return cached as Ctor<NextStateInstance<S>>;
  const cls = class {
    value: S | undefined = undefined;
    set(v: S): void {
      this.value = v;
    }
    clear(): void {
      this.value = undefined;
    }
  } as Ctor<NextStateInstance<S>>;
  Object.defineProperty(cls, 'name', { value: `NextState<${ctor.name || '<anonymous>'}>` });
  nextStateClassCache.set(ctor, cls);
  return cls;
}

interface StateSystemRecord {
  readonly id: SystemId;
  readonly params: ReadonlyArray<Param<unknown>>;
  readonly fn: (...args: unknown[]) => void;
  readonly runIf?: RunCondition;
}

/**
 * Per-`App` registry holding state-type metadata, per-value transition system
 * lists, and per-value state-scoped resource bundles. One instance is owned
 * by each `App`; not part of the public API.
 */
export class StateRegistry {
  private readonly types: Ctor<object>[] = [];
  private readonly onEnterMap = new Map<object, StateSystemRecord[]>();
  private readonly onExitMap = new Map<object, StateSystemRecord[]>();
  private readonly onTransitionMap = new Map<object, Map<object, StateSystemRecord[]>>();
  private readonly scopedResourcesMap = new Map<object, object[]>();

  addType(ctor: Ctor<object>): void {
    this.types.push(ctor);
  }

  hasType(ctor: Ctor<object>): boolean {
    return this.types.includes(ctor);
  }

  getTypes(): readonly Ctor<object>[] {
    return this.types;
  }

  addOnEnter(value: object, rec: StateSystemRecord): void {
    const arr = this.onEnterMap.get(value);
    if (arr) arr.push(rec);
    else this.onEnterMap.set(value, [rec]);
  }

  addOnExit(value: object, rec: StateSystemRecord): void {
    const arr = this.onExitMap.get(value);
    if (arr) arr.push(rec);
    else this.onExitMap.set(value, [rec]);
  }

  addOnTransition(from: object, to: object, rec: StateSystemRecord): void {
    let row = this.onTransitionMap.get(from);
    if (!row) {
      row = new Map();
      this.onTransitionMap.set(from, row);
    }
    const arr = row.get(to);
    if (arr) arr.push(rec);
    else row.set(to, [rec]);
  }

  addScopedResource(value: object, resource: object): void {
    const arr = this.scopedResourcesMap.get(value);
    if (arr) arr.push(resource);
    else this.scopedResourcesMap.set(value, [resource]);
  }

  getOnEnter(value: object): readonly StateSystemRecord[] {
    return this.onEnterMap.get(value) ?? [];
  }

  getOnExit(value: object): readonly StateSystemRecord[] {
    return this.onExitMap.get(value) ?? [];
  }

  getOnTransition(from: object, to: object): readonly StateSystemRecord[] {
    return this.onTransitionMap.get(from)?.get(to) ?? [];
  }

  getScopedResources(value: object): readonly object[] {
    return this.scopedResourcesMap.get(value) ?? [];
  }
}

const checkNoStageScope = (
  params: ReadonlyArray<Param<unknown>>,
  apiName: string,
): void => {
  for (const p of params) {
    if (p.scope !== undefined) {
      throw new Error(
        `App.${apiName}: stage-scoped param (scope='${p.scope}') cannot be used in a state-transition system — these run in the internal StateTransition phase, not in a Main stage`,
      );
    }
  }
};

const buildRecord = <const Ps extends readonly Param<unknown>[]>(
  app: App,
  params: Ps,
  fn: (...args: ParamValues<Ps>) => void,
  options: { runIf?: RunCondition } | undefined,
): StateSystemRecord => ({
  id: app.mintSystemId(),
  params,
  fn: fn as (...args: unknown[]) => void,
  ...(options?.runIf !== undefined ? { runIf: options.runIf } : {}),
});

/** Register a system to run when the state transitions **out of** `value`. */
export const registerOnExit = <S extends object, const Ps extends readonly Param<unknown>[]>(
  app: App,
  registry: StateRegistry,
  value: S,
  params: Ps,
  fn: (...args: ParamValues<Ps>) => void,
  options?: { runIf?: RunCondition },
): void => {
  checkNoStageScope(params, 'onExit');
  registry.addOnExit(value, buildRecord(app, params, fn, options));
};

/** Register a system to run when the state transitions **into** `value`. */
export const registerOnEnter = <S extends object, const Ps extends readonly Param<unknown>[]>(
  app: App,
  registry: StateRegistry,
  value: S,
  params: Ps,
  fn: (...args: ParamValues<Ps>) => void,
  options?: { runIf?: RunCondition },
): void => {
  checkNoStageScope(params, 'onEnter');
  registry.addOnEnter(value, buildRecord(app, params, fn, options));
};

/**
 * Register a system to run on the specific transition `from → to`. Bevy's
 * `OnTransition { exited, entered }` semantics — there is no any-to-any
 * helper; register per pair.
 */
export const registerOnTransition = <
  S extends object,
  const Ps extends readonly Param<unknown>[],
>(
  app: App,
  registry: StateRegistry,
  from: S,
  to: S,
  params: Ps,
  fn: (...args: ParamValues<Ps>) => void,
  options?: { runIf?: RunCondition },
): void => {
  checkNoStageScope(params, 'onTransition');
  registry.addOnTransition(from, to, buildRecord(app, params, fn, options));
};

/**
 * Register an instance to be inserted on `OnEnter(value)` and removed
 * **after** user `OnExit(value)` systems run. Two state values may carry
 * resources of the same constructor; the registry holds each instance
 * separately, and the matching one is wired in on the relevant transition.
 *
 * Calling more than once for the same `value` queues additional resources;
 * all are inserted on enter and removed on exit, in registration order.
 */
export const registerStateScopedResource = <S extends object>(
  registry: StateRegistry,
  value: S,
  resource: object,
): void => {
  registry.addScopedResource(value, resource);
};

/**
 * Initialise a state type with its initial value. Inserts the minted
 * `State<S>` and `NextState<S>` resources, seeding `NextState.value = initial`
 * so the next `StateTransition` phase fires the initial `OnEnter(initial)`.
 *
 * The `initial.constructor === ctor` check rejects values whose runtime type
 * is a subclass (or unrelated class). Throws if the same state type is
 * initialised twice.
 */
export const initStateImpl = <S extends object>(
  app: App,
  registry: StateRegistry,
  ctor: Ctor<S>,
  initial: S,
): void => {
  if (initial.constructor !== ctor) {
    throw new Error(
      `App.initState: initial value's constructor (${(initial.constructor as { name?: string }).name || '<anonymous>'}) does not match state type (${ctor.name || '<anonymous>'})`,
    );
  }
  if (registry.hasType(ctor as Ctor<object>)) {
    throw new Error(
      `App.initState: state type ${ctor.name || '<anonymous>'} is already initialised`,
    );
  }
  const StateCls = State(ctor);
  const NextStateCls = NextState(ctor);
  const stateInst = new StateCls();
  const nextInst = new NextStateCls();
  nextInst.set(initial);
  app.insertResource(stateInst as object);
  app.insertResource(nextInst as object);
  registry.addType(ctor as Ctor<object>);
};

const invokeStateSystem = (rec: StateSystemRecord, app: App): void => {
  if (rec.runIf && !rec.runIf.test(app)) return;
  const ctx: ResolveCtx = {
    app,
    world: app.world,
    // 'stateTransition' is an internal driver phase — not part of the
    // user-registerable Stage union. Cast keeps ResolveCtx.stage typed as
    // Stage (per ADR-0006's sealed shape) without leaking the synthetic
    // label into the public Stage type.
    stage: 'stateTransition' as Stage,
    systemId: rec.id,
  };
  const values = rec.params.map((p) => p.resolve(ctx));
  rec.fn(...values);
};

const runRecords = (recs: readonly StateSystemRecord[], app: App): void => {
  for (const rec of recs) invokeStateSystem(rec, app);
};

/**
 * Drive the StateTransition phase for one frame: for every registered state
 * type with a pending `NextState.value`, apply the transition in the order
 * sealed by ADR-0008 §3:
 *
 *   1. User OnExit(S_old) systems
 *   2. Remove state-scoped resources for S_old
 *   3. State.current = S_new
 *   4. User OnTransition(S_old, S_new) systems
 *   5. Insert state-scoped resources for S_new
 *   6. User OnEnter(S_new) systems
 *
 * Initial transition (`S_old === undefined`) skips steps 1, 2, 4.
 *
 * A single iteration per state type — transitions queued by systems running
 * during this phase are picked up at the next frame's StateTransition.
 */
export const runStateTransition = (app: App, registry: StateRegistry): void => {
  for (const ctor of registry.getTypes()) {
    const stateInst = app.getResource(State(ctor)) as StateInstance<object> | undefined;
    const nextInst = app.getResource(NextState(ctor)) as NextStateInstance<object> | undefined;
    if (!stateInst || !nextInst) continue;
    const to = nextInst.value;
    if (to === undefined) continue;
    const from = stateInst.current;
    nextInst.clear();

    if (from !== undefined) {
      runRecords(registry.getOnExit(from), app);
      for (const res of registry.getScopedResources(from)) {
        app.removeResource((res as { constructor: Ctor<object> }).constructor);
      }
    }
    stateInst.current = to;
    if (from !== undefined) {
      runRecords(registry.getOnTransition(from, to), app);
    }
    for (const res of registry.getScopedResources(to)) {
      app.insertResource(res);
    }
    runRecords(registry.getOnEnter(to), app);
  }
};
