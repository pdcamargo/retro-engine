import type { ComponentType, Entity, World } from '@retro-engine/ecs';

import type { CommandsHandle } from './commands';
import type { App } from './index';
import { dispatchTargetedTrigger } from './observers';
import type { SystemId } from './system-param';

/**
 * Context handed to a component lifecycle hook. The shape is forward-stable:
 * adding fields (e.g. a `DeferredWorld` wrapper) is additive on the readonly
 * facade and does not break callers.
 *
 * - `world` is the live world. Direct mutations are allowed but discouraged;
 *   prefer enqueuing via `commands` so re-entrant ops respect the
 *   deterministic per-system Commands flush ordering.
 * - `commands` is bound to the triggering system's command buffer, so any
 *   mutation a hook enqueues fires later in the same flush.
 * - `entity` is the row the hook is firing for.
 * - `value` is the component value at the hook's logical moment:
 *    - `onAdd` / `onInsert` — the just-installed value (storage already
 *      reflects the write).
 *    - `onReplace` — the **old** value, before the new one overwrites it.
 *    - `onRemove` — the about-to-be-removed value, before storage clears it
 *      (so `world.getComponent(entity, T)` still returns it inside the
 *      hook body).
 */
export interface HookCtx<T> {
  readonly world: World;
  readonly commands: CommandsHandle;
  readonly entity: Entity;
  readonly value: T;
}

/** The four component lifecycle moments a hook can attach to. */
export type HookKind = 'onAdd' | 'onInsert' | 'onReplace' | 'onRemove';

type HookFn<T = unknown> = (ctx: HookCtx<T>) => void;

interface PerTypeHooks {
  readonly onAdd: HookFn[];
  readonly onInsert: HookFn[];
  readonly onReplace: HookFn[];
  readonly onRemove: HookFn[];
}

/**
 * Per-app registry of plugin-side component hooks. The class-static side —
 * `class Sprite { static onAdd(ctx) {…} }` — is discovered reflectively at
 * dispatch time and fires first; registry entries fire next, in registration
 * order.
 *
 * Single resolution path: callers do not see the static-vs-registry split.
 *
 * @internal Engine-private; consumers go through
 * `App.registerComponentHook`.
 */
export class ComponentHookRegistry {
  private readonly hooks = new Map<ComponentType, PerTypeHooks>();

  /** Append `fn` to the `kind`-list for `ctor` (registration order). */
  register(ctor: ComponentType, kind: HookKind, fn: HookFn): void {
    let perType = this.hooks.get(ctor);
    if (!perType) {
      perType = { onAdd: [], onInsert: [], onReplace: [], onRemove: [] };
      this.hooks.set(ctor, perType);
    }
    perType[kind].push(fn);
  }

  /**
   * Whether any hook of any kind is reachable for `ctor` — either via the
   * registry or via a static method on the constructor. Used by the
   * dispatcher to fast-path the no-hooks case.
   */
  hasAny(ctor: ComponentType): boolean {
    if (this.hooks.has(ctor)) return true;
    const c = ctor as Partial<Record<HookKind, HookFn>>;
    return (
      typeof c.onAdd === 'function' ||
      typeof c.onInsert === 'function' ||
      typeof c.onReplace === 'function' ||
      typeof c.onRemove === 'function'
    );
  }

  /**
   * Whether a hook of `kind` exists for `ctor`. Cheaper than `hasAny` when
   * only one kind is being dispatched.
   */
  has(ctor: ComponentType, kind: HookKind): boolean {
    const perType = this.hooks.get(ctor);
    if (perType && perType[kind].length > 0) return true;
    const staticFn = (ctor as Partial<Record<HookKind, HookFn>>)[kind];
    return typeof staticFn === 'function';
  }

  /**
   * Fire `kind` for `ctor` with `ctx`. Order: the constructor's static
   * method (if defined) first, then registry entries in registration order.
   * Throws if the constructor's static hook or a registry entry throws;
   * the throw propagates to the commands flush, which is responsible for
   * cleanup.
   */
  dispatch(ctor: ComponentType, kind: HookKind, ctx: HookCtx<unknown>): void {
    const staticFn = (ctor as Partial<Record<HookKind, HookFn>>)[kind];
    if (typeof staticFn === 'function') {
      staticFn(ctx);
    }
    const perType = this.hooks.get(ctor);
    if (perType) {
      for (const fn of perType[kind]) fn(ctx);
    }
  }
}

/**
 * Event payload delivered to a lifecycle observer (an observer registered
 * against one of the {@link Lifecycle} event classes). Shape mirrors
 * {@link HookCtx} sans `world` / `commands` — both of which are reachable
 * from the observer body's own param resolution.
 *
 * `value` carries the same semantics as the hook of the matching kind:
 *  - `onAdd` / `onInsert` — the just-installed value.
 *  - `onReplace` — the OLD value, pre-overwrite.
 *  - `onRemove` — the about-to-be-removed value, still present in storage.
 *
 * @typeParam T - the component class the lifecycle event was raised against.
 */
export interface LifecycleEvent<T> {
  readonly entity: Entity;
  readonly value: T;
}

/**
 * Constructor shape for synthetic lifecycle event classes. Instances are
 * built lazily inside {@link dispatchLifecycleObservers}; consumers obtain
 * the class itself from {@link Lifecycle}.
 *
 * @internal
 */
type LifecycleEventCtor<T> = new (entity: Entity, value: T) => LifecycleEvent<T>;

interface LifecycleCacheEntry {
  onAdd?: LifecycleEventCtor<unknown>;
  onInsert?: LifecycleEventCtor<unknown>;
  onReplace?: LifecycleEventCtor<unknown>;
  onRemove?: LifecycleEventCtor<unknown>;
}

const lifecycleCache = new WeakMap<ComponentType, LifecycleCacheEntry>();

const makeLifecycleCtor = (
  kind: HookKind,
  ctor: ComponentType,
): LifecycleEventCtor<unknown> => {
  let entry = lifecycleCache.get(ctor);
  if (!entry) {
    entry = {};
    lifecycleCache.set(ctor, entry);
  }
  const cached = entry[kind];
  if (cached) return cached;
  class LifecycleEventCls {
    constructor(
      readonly entity: Entity,
      readonly value: unknown,
    ) {}
  }
  Object.defineProperty(LifecycleEventCls, 'name', {
    value: `${kind}<${ctor.name || '<anonymous>'}>`,
  });
  const created = LifecycleEventCls as unknown as LifecycleEventCtor<unknown>;
  entry[kind] = created;
  return created;
};

/**
 * Event-class factory for lifecycle observers. Returns a stable, cached
 * synthetic class per `(kind, componentCtor)` pair — the same class
 * identity each call, so the class is usable as the event-key for
 * `app.addObserver`, `commands.entity(e).observe`, and {@link Trigger}:
 *
 * ```ts
 * Lifecycle.onAdd(Sprite) === Lifecycle.onAdd(Sprite);   // true
 * Lifecycle.onAdd(Sprite) !== Lifecycle.onInsert(Sprite); // disjoint kinds
 * Lifecycle.onAdd(Sprite) !== Lifecycle.onAdd(OtherComp); // disjoint types
 * ```
 *
 * The returned class instantiates to {@link LifecycleEvent}`<T>` — observer
 * bodies access the originating entity via `trig.entity()` and the
 * component value via `trig.event().value`.
 *
 * Observers registered against one of these classes fire **before**
 * component hooks for the same `(kind, type)` — see the dispatch site in
 * the engine's commands flush.
 *
 * @example
 * ```ts
 * class Sprite { constructor(public src: string) {} }
 *
 * app.addObserver(
 *   Lifecycle.onAdd(Sprite),
 *   [Trigger(Lifecycle.onAdd(Sprite))],
 *   (trig) => {
 *     console.log(`sprite ${trig.event().value.src} appeared on ${trig.entity()}`);
 *   },
 * );
 * ```
 */
export const Lifecycle = {
  /** Lifecycle event for the first attachment of a component to an entity. */
  onAdd<T extends object>(ctor: ComponentType<T>): LifecycleEventCtor<T> {
    return makeLifecycleCtor('onAdd', ctor as unknown as ComponentType) as LifecycleEventCtor<T>;
  },
  /** Lifecycle event for every insert pass touching a component (new-add or replace-in-place). */
  onInsert<T extends object>(ctor: ComponentType<T>): LifecycleEventCtor<T> {
    return makeLifecycleCtor('onInsert', ctor as unknown as ComponentType) as LifecycleEventCtor<T>;
  },
  /** Lifecycle event for in-place replacement of an existing component (delivers the OLD value). */
  onReplace<T extends object>(ctor: ComponentType<T>): LifecycleEventCtor<T> {
    return makeLifecycleCtor('onReplace', ctor as unknown as ComponentType) as LifecycleEventCtor<T>;
  },
  /** Lifecycle event for the removal of a component (including the per-component fan-out at despawn). */
  onRemove<T extends object>(ctor: ComponentType<T>): LifecycleEventCtor<T> {
    return makeLifecycleCtor('onRemove', ctor as unknown as ComponentType) as LifecycleEventCtor<T>;
  },
} as const;

/**
 * Fire every lifecycle observer (entity-targeted first, then global) for
 * `(kind, type)` on `entity`. Called by the four `apply*WithHooks` helpers
 * immediately before they dispatch the matching component hook, so
 * observers always run before hooks for the same logical moment.
 *
 * Lifecycle dispatch is inline — it does not enqueue a trigger command, so
 * it does not consume a depth slot. Re-entrant triggers that an observer
 * body posts via `commands.trigger` continue to be capped by
 * `MAX_TRIGGER_DEPTH` on the gameplay-event side.
 *
 * Fast-paths out when no observer (global or entity-targeted) is
 * registered for the synthesised event class — no event instance is
 * allocated in that case.
 *
 * @internal
 */
export const dispatchLifecycleObservers = (
  app: App,
  kind: HookKind,
  type: ComponentType,
  triggeringSystemId: SystemId,
  entity: Entity,
  value: unknown,
): void => {
  const evtCtor = makeLifecycleCtor(kind, type);
  const evtKey = evtCtor as unknown as ComponentType;
  const registry = app.observerRegistry;
  if (
    registry.globalsFor(evtKey).length === 0 &&
    registry.targetedFor(entity, evtKey).length === 0
  ) {
    return;
  }
  const event = new evtCtor(entity, value);
  dispatchTargetedTrigger(
    app,
    event as unknown as object,
    entity,
    triggeringSystemId,
    app.currentFlushStage,
    app.currentTriggerDepth,
  );
};
