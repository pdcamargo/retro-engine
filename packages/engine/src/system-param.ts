import type {
  ComponentType,
  Entity,
  Query as QueryHandle,
  QueryFilters,
  World,
} from '@retro-engine/ecs';
import { componentId } from '@retro-engine/ecs';

import type { App, RenderContext, Stage } from './index';
import type { RenderSetName } from './render-set';

/**
 * Opaque identity of a registered system. Minted by `App.addSystem` and used
 * as the key under which per-system state (e.g. a future `Local<T>` cell) is
 * stored. Consumers cannot construct one.
 */
export type SystemId = number & { readonly __brand: 'SystemId' };

/**
 * Context handed to every {@link Param.resolve} call. The same object shape is
 * passed in every stage; `render` is present only during render-stage systems.
 *
 * The contents are read-only — params resolve values from the context, they do
 * not mutate it. Mutations to `world` or resources happen through the values
 * the params return (or, later, through a `Commands` param's deferred queue).
 *
 * `lastSeenTick` is the calling system's pre-run snapshot of
 * `World.changeTick`, captured by the scheduler before any param resolves.
 * Component change-detection params (`Query` with `changed`/`added` filters,
 * `RemovedComponents`) use it as their per-system observation threshold; a
 * row or removed entry matches iff its tick is strictly greater than
 * `lastSeenTick`. Systems on their first invocation see `0`, which means "no
 * scoping — observe everything."
 *
 * `lastSeenFrame` is the analogous per-system snapshot for the resource
 * frame counter (driven by `Time.frame`). Resource change-detection params
 * (`ChangedRes`, `ResAdded`) use it as their per-system observation
 * threshold; a stamp matches iff it is strictly greater than
 * `lastSeenFrame`. First-run value is `-1` so any stamp ≥ 0 fires.
 */
export interface ResolveCtx {
  readonly app: App;
  readonly world: World;
  readonly stage: Stage;
  readonly systemId: SystemId;
  readonly lastSeenTick: number;
  readonly lastSeenFrame: number;
  /** Present only during render-stage system invocation. */
  readonly render?: RenderContext;
  /**
   * Render sub-set currently driving the call. Set during render-stage
   * system resolution; `undefined` for every other stage. Read by
   * {@link RenderCtx} so it can produce a more useful error when a system
   * outside the {@link RenderSet.Render} set asks for the pass encoder.
   */
  readonly renderSet?: RenderSetName;
  /**
   * Set when an observer is being dispatched in response to a triggered
   * event. The `Trigger<E>` param reads it to expose `trigger.event()` to
   * the observer body. `undefined` in every non-observer context.
   *
   * @internal
   */
  readonly triggerEvent?: unknown;
  /**
   * Set when an *entity-targeted* observer is being dispatched. `undefined`
   * for global-trigger observers and for all non-observer contexts.
   *
   * @internal
   */
  readonly triggerEntity?: Entity;
}

/**
 * A system param declares "I want something resolved out of the app/world and
 * passed into the system as one of its arguments." Implementations expose
 * exactly two pieces of information: the value's type (carried as `T`) and
 * how to produce a value from the resolve context.
 *
 * `T` is declared `out` so TypeScript can recover the param's value type when
 * mapping a tuple of params to the system function's argument tuple.
 *
 * Optional `scope` restricts the param to one stage. Registration throws if a
 * scoped param appears in the wrong stage.
 *
 * Optional `exclusive` marks a param that grants whole-`World` mutable access
 * ({@link world}); a system carrying one must declare no other params, so it
 * runs alone with unaliased access. Registration throws otherwise.
 */
export interface Param<out T = unknown> {
  resolve(ctx: ResolveCtx): T;
  readonly scope?: Stage;
  readonly exclusive?: boolean;
}

/**
 * Stage-scoped param that resolves to the active frame's {@link RenderContext}.
 * Valid only inside the {@link RenderSet.Render} sub-set of the `'render'`
 * stage — the only set where the pass encoder is open. Registration throws
 * if used in another stage; resolution throws if a render-stage system uses
 * it in any set other than `Render` (i.e. `Extract`, `Prepare`, `Queue`,
 * `PhaseSort`, `Cleanup`).
 *
 * @example
 * ```ts
 * app.addSystem('render', [RenderCtx], (ctx) => {
 *   ctx.pass.setPipeline(pipeline);
 *   ctx.pass.draw(3);
 * });
 * ```
 */
export const RenderCtx: Param<RenderContext> = {
  scope: 'render',
  resolve(ctx) {
    if (!ctx.render) {
      const setSuffix = ctx.renderSet !== undefined ? ` (set '${ctx.renderSet}')` : '';
      throw new Error(
        `RenderCtx: no render context available in stage '${ctx.stage}'${setSuffix} — RenderCtx is valid only inside the Render sub-set of the 'render' stage`,
      );
    }
    return ctx.render;
  },
};

/**
 * Exclusive-access param: resolves to the whole {@link World} with mutable
 * access, for a system that needs to make structural changes **immediately**
 * (spawn / despawn / insert / remove) rather than deferring them through
 * {@link Commands}. Useful for complex spawn logic, tooling, and one-shot setup
 * where reading back the change within the same system matters.
 *
 * A system using `world()` must declare **no other params** — it holds the
 * entire world, so any other param would alias it. Registration throws
 * otherwise. Resolves to the stage's world (the main world for main stages, the
 * render world in the `'render'` stage).
 *
 * @example
 * ```ts
 * app.addSystem('startup', [world()], (w) => {
 *   const player = w.spawn(new Transform());
 *   w.insertBundle(player, [new Health(100)]);
 * });
 * ```
 */
export const world = (): Param<World> => ({
  exclusive: true,
  resolve: (ctx) => ctx.world,
});

/**
 * Wraps a {@link Param} so it resolves against the main `World`
 * (`app.world`) even when the calling system runs against the render
 * world. Used inside render-stage systems — typically Extract-set systems —
 * to read gameplay data without coupling the render world's schema to it.
 *
 * The inner param's `scope` is preserved unchanged, so `Extract(RenderCtx)`
 * is still a render-stage param. The inner param's `lastSeenTick` /
 * `lastSeenFrame` are inherited from the outer context — change-detection
 * across worlds is a known sharp edge in Phase 1; prefer plain
 * `Extract(Query([T]))` over `Extract(Query([T], { changed: [T] }))` until
 * cross-world ticks are addressed in a follow-up.
 *
 * Read-only by convention — Extract systems should not mutate main-world
 * state. The HAL does not enforce this; pair with `Res(...)` (not
 * `ResMut(...)`) at call sites.
 *
 * @example
 * ```ts
 * app.addSystem(
 *   'render',
 *   [Extract(Query([GlobalTransform]))],
 *   (q) => {
 *     for (const [g] of q) app.renderWorld.spawn(new ExtractedTransform(g.matrix));
 *   },
 *   { set: RenderSet.Extract },
 * );
 * ```
 */
export function Extract<T>(inner: Param<T>): Param<T> {
  const wrapped: Param<T> = {
    resolve(ctx) {
      const swapped: ResolveCtx = { ...ctx, world: ctx.app.world };
      return inner.resolve(swapped);
    },
    ...(inner.scope !== undefined ? { scope: inner.scope } : {}),
  };
  return wrapped;
}

type DeepReadonly<T> = T extends (...args: never) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends ReadonlySet<infer U>
        ? ReadonlySet<DeepReadonly<U>>
        : T extends object
          ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
          : T;

const resCache = new WeakMap<object, Param<unknown>>();
const resMutCache = new WeakMap<object, Param<unknown>>();

const missingResourceError = (label: 'Res' | 'ResMut', ctorName: string): Error => {
  const name = ctorName || '<anonymous>';
  return new Error(
    `${label}(${name}): resource not registered — did you forget app.insertResource(new ${name}())?`,
  );
};

/**
 * Declares a **read-only** dependency on a resource of type `T`. The system
 * receives the live instance previously registered via `App.insertResource`,
 * typed as {@link DeepReadonly} so mutations are a compile error; resolution
 * throws if no matching resource is present.
 *
 * Tokens are cached per constructor — `Res(Foo) === Res(Foo)` — so identity
 * checks against the returned `Param` are stable across calls. The cache is
 * distinct from `ResMut`'s, so `Res(Foo) !== ResMut(Foo)` — a future schedule
 * graph can distinguish read and write intent by token identity.
 *
 * Pair with {@link ResMut} when the system needs to write.
 *
 * @example
 * ```ts
 * class Score { value = 0; }
 * app.insertResource(new Score());
 * app.addSystem('update', [Res(Score)], (score) => {
 *   console.log(score.value);
 *   // score.value = 1;  // compile error — use ResMut(Score) to write
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Res<T extends object>(ctor: new (...a: any[]) => T): Param<DeepReadonly<T>> {
  const cached = resCache.get(ctor);
  if (cached) return cached as Param<DeepReadonly<T>>;
  const param: Param<DeepReadonly<T>> = {
    resolve(ctx) {
      const value = ctx.app.getResource(ctor);
      if (value === undefined) throw missingResourceError('Res', ctor.name);
      return value as DeepReadonly<T>;
    },
  };
  resCache.set(ctor, param);
  return param;
}

/**
 * Declares a **mutable** dependency on a resource of type `T`. Runtime
 * behaviour is identical to {@link Res} — the system receives the same live
 * instance previously registered via `App.insertResource` — but the value is
 * typed as `T` rather than `DeepReadonly<T>`, so writes (`score.value = 1`)
 * typecheck. Resolution throws if no matching resource is present.
 *
 * Tokens are cached per constructor and are distinct from `Res`'s cache, so
 * `ResMut(Foo) === ResMut(Foo)` and `Res(Foo) !== ResMut(Foo)`.
 *
 * @example
 * ```ts
 * class Score { value = 0; }
 * app.insertResource(new Score());
 * app.addSystem('update', [ResMut(Score)], (score) => {
 *   score.value += 1;
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ResMut<T extends object>(ctor: new (...a: any[]) => T): Param<T> {
  const cached = resMutCache.get(ctor);
  if (cached) return cached as Param<T>;
  const param: Param<T> = {
    resolve(ctx) {
      const value = ctx.app.getResource(ctor);
      if (value === undefined) throw missingResourceError('ResMut', ctor.name);
      return value;
    },
  };
  resMutCache.set(ctor, param);
  return param;
}

/**
 * A per-system persistent state slot resolved by {@link Local}. The wrapped value
 * lives in `.current` — read and write it freely; it survives across frames and is
 * private to the single system that declared the `Local`.
 */
export class LocalState<T> {
  constructor(public current: T) {}
}

/**
 * Declares **per-system persistent local state** — an accumulator, frame counter,
 * or system-private cache. Lazily initialized on the system's first run via
 * `factory` (Bevy's `Local<T>`); the same {@link LocalState} instance is then
 * handed back on every subsequent run, so writes to `.current` persist.
 *
 * Each `Local(...)` call returns a distinct param with its own slot, so two
 * systems declaring `Local(() => 0)` do not share state.
 *
 * @example
 * ```ts
 * app.addSystem('update', [Local(() => 0)], (frame) => {
 *   frame.current += 1; // increments once per frame, persists across frames
 * });
 * ```
 */
export const Local = <T>(factory: () => T): Param<LocalState<T>> => {
  let state: LocalState<T> | undefined;
  return {
    resolve(): LocalState<T> {
      state ??= new LocalState(factory());
      return state;
    },
  };
};

/**
 * A composable gate that decides whether a system runs on a given tick.
 * Wrap any `(app) => boolean` predicate, then combine with `.and(...)`,
 * `.or(...)`, `.not()`. Conditions are evaluated once per system per stage
 * run; if `test` returns `false`, the system is skipped (no params resolve).
 *
 * @example
 * ```ts
 * const isReady = new RunCondition((app) => app.getResource(Bootstrapped) !== undefined);
 * app.addSystem('update', [], onReady, { runIf: isReady });
 * ```
 */
export class RunCondition {
  constructor(private readonly check: (app: App) => boolean) {}

  test(app: App): boolean {
    return this.check(app);
  }

  and(other: RunCondition): RunCondition {
    return new RunCondition((app) => this.check(app) && other.check(app));
  }

  or(other: RunCondition): RunCondition {
    return new RunCondition((app) => this.check(app) || other.check(app));
  }

  not(): RunCondition {
    return new RunCondition((app) => !this.check(app));
  }
}

/**
 * Maps a tuple of {@link Param}s to the tuple of values the system function
 * receives. Used by `App.addSystem`'s signature to recover per-slot types
 * from the params tuple without explicit type arguments at the call site.
 */
export type ParamValues<Ps extends readonly Param<unknown>[]> = {
  -readonly [K in keyof Ps]: Ps[K] extends Param<infer T> ? T : never;
};

const queryCache = new Map<string, Param<unknown>>();

const queryKey = (types: readonly ComponentType[], filters?: QueryFilters): string => {
  const t = types.map(componentId).join(',');
  if (!filters) return `t:${t}`;
  const sortedIds = (cs: readonly ComponentType[] | undefined): string =>
    cs
      ? cs
          .map(componentId)
          .sort((a, b) => a - b)
          .join(',')
      : '';
  const orderedIds = (cs: readonly ComponentType[] | undefined): string =>
    cs ? cs.map(componentId).join(',') : '';
  // `with` / `without` / `changed` / `added` are set-semantic; `has` order
  // affects row shape.
  return `t:${t}|w:${sortedIds(filters.with)}|wo:${sortedIds(filters.without)}|h:${orderedIds(filters.has)}|c:${sortedIds(filters.changed)}|a:${sortedIds(filters.added)}`;
};

/**
 * Declares a dependency on a multi-component query. The system receives a
 * {@link QueryHandle} over rows matching the listed component types (and any
 * optional `with` / `without` / `has` filter clauses). Iterate with
 * `for...of`, or call `.first()`, `.single()`, `.count()` on the handle.
 *
 * Tokens are cached per (types-array-order, filter-shape) so
 * `Query([A, B]) === Query([A, B])` and a future schedule planner can dedup
 * read/write sets by token identity. `with` / `without` are normalized (set
 * semantics); `has` preserves declaration order because it affects the
 * yielded row shape.
 *
 * @example
 * ```ts
 * class Position { constructor(public x = 0, public y = 0) {} }
 * class Velocity { constructor(public vx = 0, public vy = 0) {} }
 * app.addSystem('update', [Query([Position, Velocity])], (q) => {
 *   for (const [pos, vel] of q) pos.x += vel.vx;
 * });
 * ```
 */
export function Query<
  const Ts extends readonly ComponentType[],
  F extends QueryFilters | undefined = undefined,
>(types: Ts, filters?: F): Param<QueryHandle<Ts, F>> {
  const key = queryKey(types, filters);
  const cached = queryCache.get(key);
  if (cached) return cached as Param<QueryHandle<Ts, F>>;
  const param: Param<QueryHandle<Ts, F>> = {
    resolve(ctx) {
      return ctx.world.query(types, filters, ctx.lastSeenTick);
    },
  };
  queryCache.set(key, param as Param<unknown>);
  return param;
}

const changedResCache = new WeakMap<object, Param<boolean>>();
const resAddedCache = new WeakMap<object, Param<boolean>>();

/**
 * Declares a dependency on the change status of a resource. Resolves to
 * `true` iff the resource keyed by `ctor` has been inserted, replaced,
 * removed, or `markResourceChanged`-stamped since the calling system last
 * ran (or has ever been stamped, for a system's first invocation).
 *
 * Declared alongside `Res(T)` / `ResMut(T)` in a system signature when the
 * system needs both the resource value and a "did it change?" gate inside
 * its body. For all-or-nothing skipping, pair `resourceChanged(T)` with
 * `runIf` instead.
 *
 * Cross-frame accumulation comes for free: a `runIf`-gated system that
 * doesn't run in frame F still sees frame F's changes on its next actual
 * run, because `lastSeenFrame` only advances when the system actually
 * runs.
 *
 * Tokens are cached per constructor — `ChangedRes(Foo) === ChangedRes(Foo)`.
 *
 * In-place field writes (`resource.value = 1`) do not auto-bump the
 * change stamp; call `app.markResourceChanged(Foo)` or
 * `cmd.markResourceChanged(Foo)` after the mutation to fire `ChangedRes`.
 *
 * @example
 * ```ts
 * app.addSystem('update', [ResMut(Counter), ChangedRes(Counter)], (counter, didChange) => {
 *   if (didChange) recomputeExpensiveThing(counter);
 *   counter.value += 1;
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ChangedRes<T>(ctor: new (...a: any[]) => T): Param<boolean> {
  const cached = changedResCache.get(ctor);
  if (cached) return cached;
  const param: Param<boolean> = {
    resolve(ctx) {
      const stamp = ctx.app.getResourceChangeFrame(ctor);
      if (stamp === undefined) return false;
      // `>=` not `>`: frame stamps are per-frame (not per-mutation like
      // component ticks), so a mark inside a system's body lands on the
      // same frame the system itself observed as `frameAtRunStart`. Using
      // `>=` preserves the contract that a system observes its own
      // prior-run writes on next run, matching the pre-run-snapshot model
      // already used by component change detection.
      return stamp >= ctx.lastSeenFrame;
    },
  };
  changedResCache.set(ctor, param);
  return param;
}

/**
 * Declares a dependency on the added status of a resource. Resolves to
 * `true` iff the resource keyed by `ctor` was inserted fresh (against a
 * key that was not currently registered) since the calling system last
 * ran. Replacements of an already-registered resource do not fire — only
 * the first insert against a clean slot, mirroring the component-side
 * `Added<T>` filter.
 *
 * Removing the resource clears its added-frame slot, so a future
 * re-insertion counts as a fresh add again — useful for systems doing
 * one-time setup work whenever a resource appears (e.g. priming caches
 * for an `AudioMixer` that may be teardown/recreated across scenes).
 *
 * Tokens are cached per constructor — `ResAdded(Foo) === ResAdded(Foo)`.
 *
 * @example
 * ```ts
 * app.addSystem('update', [ResAdded(AudioMixer)], (justAppeared) => {
 *   if (justAppeared) primeMixerVoices();
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ResAdded<T>(ctor: new (...a: any[]) => T): Param<boolean> {
  const cached = resAddedCache.get(ctor);
  if (cached) return cached;
  const param: Param<boolean> = {
    resolve(ctx) {
      const stamp = ctx.app.getResourceAddedFrame(ctor);
      if (stamp === undefined) return false;
      // `>=`: see the comparison-rule comment on `ChangedRes`.
      return stamp >= ctx.lastSeenFrame;
    },
  };
  resAddedCache.set(ctor, param);
  return param;
}
