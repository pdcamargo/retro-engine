import type { ComponentType, Entity } from '@retro-engine/ecs';

import type { App, Stage } from './index';
import type { Param, ParamValues, ResolveCtx } from './system-param';

/**
 * Value handed to observer bodies that declare a {@link Trigger} param.
 *
 * - `event()` returns the triggering event payload.
 * - `entity()` returns the target entity for entity-targeted triggers, or
 *   `undefined` for global ones.
 *
 * Accessors over a destructure literal so the surface is forward-stable —
 * future additions like `propagate()` (event propagation up the hierarchy)
 * or `depth()` (re-entrant chain introspection) are additive on methods,
 * breaking on destructure.
 */
export interface TriggerHandle<E> {
  /** The triggering event payload. */
  event(): E;
  /** The target entity for entity-targeted triggers, or `undefined` for global. */
  entity(): Entity | undefined;
}

const triggerCache = new WeakMap<object, Param<TriggerHandle<unknown>>>();

/**
 * Declares an observer's dependency on the triggering event. Only valid
 * inside an observer body (registered via
 * {@link "@retro-engine/engine".App.addObserver} or
 * `commands.entity(e).observe`); resolving the param outside an observer
 * context throws.
 *
 * Tokens are cached per event constructor:
 * `Trigger(MyEvent) === Trigger(MyEvent)`.
 *
 * @example
 * ```ts
 * class PlayerDied { constructor(public player: Entity) {} }
 * app.addObserver([Trigger(PlayerDied)], (t) => {
 *   const dead = t.event().player;
 *   console.log(`player ${dead} died`);
 * });
 * ```
 */
export function Trigger<E extends object>(
  ctor: ComponentType<E>,
): Param<TriggerHandle<E>> {
  const cached = triggerCache.get(ctor);
  if (cached) return cached as Param<TriggerHandle<E>>;
  const param: Param<TriggerHandle<E>> = {
    resolve(ctx) {
      if (ctx.triggerEvent === undefined) {
        throw new Error(
          `Trigger(${ctor.name || '<anonymous>'}): Trigger<E> param resolved outside an observer context — only valid inside app.addObserver / commands.entity(e).observe bodies`,
        );
      }
      const event = ctx.triggerEvent as E;
      const entity = ctx.triggerEntity;
      return {
        event(): E {
          return event;
        },
        entity(): Entity | undefined {
          return entity;
        },
      };
    },
  };
  triggerCache.set(ctor, param as Param<TriggerHandle<unknown>>);
  return param;
}

/** One registered observer entry: the params it resolves and the function to invoke. */
interface ObserverEntry {
  readonly id: number;
  readonly params: ReadonlyArray<Param<unknown>>;
  readonly fn: (...args: unknown[]) => void;
}

/**
 * Per-app registry of event observers, keyed by event class. Global
 * observers fire for any trigger of their event type; entity-targeted
 * observers fire only for triggers against their bound entity (in addition
 * to the global subscribers, which always fire).
 *
 * Targeted-observer cleanup is automatic on entity despawn: the commands
 * flush's `despawn` arm calls {@link ObserverRegistry.clearTargetedFor}
 * before the structural mutation, so an entity's observers do not leak
 * after its row is reclaimed.
 *
 * @internal Engine-private; consumers go through `App.addObserver` and
 * `commands.entity(e).observe`.
 */
export class ObserverRegistry {
  private nextObserverId = 1;
  private readonly globalByEvent = new Map<ComponentType, ObserverEntry[]>();
  private readonly targetedByEntity = new Map<Entity, Map<ComponentType, ObserverEntry[]>>();

  /** Register a global observer. Returns the assigned observer id. */
  registerGlobal(
    eventCtor: ComponentType,
    params: ReadonlyArray<Param<unknown>>,
    fn: (...args: unknown[]) => void,
  ): number {
    const id = this.nextObserverId++;
    let bucket = this.globalByEvent.get(eventCtor);
    if (!bucket) {
      bucket = [];
      this.globalByEvent.set(eventCtor, bucket);
    }
    bucket.push({ id, params, fn });
    return id;
  }

  /** Register an entity-targeted observer. Returns the assigned observer id. */
  registerTargeted(
    entity: Entity,
    eventCtor: ComponentType,
    params: ReadonlyArray<Param<unknown>>,
    fn: (...args: unknown[]) => void,
  ): number {
    const id = this.nextObserverId++;
    let perEntity = this.targetedByEntity.get(entity);
    if (!perEntity) {
      perEntity = new Map();
      this.targetedByEntity.set(entity, perEntity);
    }
    let bucket = perEntity.get(eventCtor);
    if (!bucket) {
      bucket = [];
      perEntity.set(eventCtor, bucket);
    }
    bucket.push({ id, params, fn });
    return id;
  }

  /** Global observers registered against `eventCtor`, in registration order. */
  globalsFor(eventCtor: ComponentType): readonly ObserverEntry[] {
    return this.globalByEvent.get(eventCtor) ?? [];
  }

  /** Entity-targeted observers for `(entity, eventCtor)`, in registration order. */
  targetedFor(entity: Entity, eventCtor: ComponentType): readonly ObserverEntry[] {
    return this.targetedByEntity.get(entity)?.get(eventCtor) ?? [];
  }

  /**
   * Drop every entity-targeted observer bound to `entity`. Called by the
   * commands flush's `despawn` arm before the structural mutation so an
   * observer attached to a doomed entity does not outlive its target.
   */
  clearTargetedFor(entity: Entity): void {
    this.targetedByEntity.delete(entity);
  }
}

/** Maximum re-entrant trigger depth. Matches Bevy. */
export const MAX_TRIGGER_DEPTH = 8;

/**
 * Invoke `observer.fn` with its params resolved against a freshly-built
 * {@link ResolveCtx} that carries the triggering event and (for targeted
 * triggers) the target entity. Tracks `app.currentTriggerDepth` so the
 * commands handle inside the observer body stamps newly-enqueued trigger
 * ops with the correct depth.
 *
 * @internal
 */
export function invokeObserver(
  app: App,
  observer: ObserverEntry,
  event: object,
  target: Entity | undefined,
  triggeringSystemId: number,
  triggeringStage: Stage,
  depth: number,
): void {
  const prevDepth = app.currentTriggerDepth;
  app.currentTriggerDepth = depth;
  try {
    const ctx: ResolveCtx = {
      app,
      world: app.world,
      stage: triggeringStage,
      systemId: triggeringSystemId as ResolveCtx['systemId'],
      lastSeenTick: 0,
      triggerEvent: event,
      ...(target !== undefined ? { triggerEntity: target } : {}),
    };
    const values = observer.params.map((p) => p.resolve(ctx));
    observer.fn(...values);
  } finally {
    app.currentTriggerDepth = prevDepth;
  }
}

/**
 * Dispatch a global trigger: walk every global observer registered against
 * `eventCtor` and invoke its body. Observer commands queue into the
 * triggering system's buffer and fire later in the same flush (subject to
 * the re-entrant depth limit, {@link MAX_TRIGGER_DEPTH}).
 *
 * @internal
 */
export function dispatchGlobalTrigger(
  app: App,
  event: object,
  triggeringSystemId: number,
  triggeringStage: Stage,
  depth: number,
): void {
  const eventCtor = event.constructor as ComponentType;
  const globals = app.observerRegistry.globalsFor(eventCtor);
  for (const observer of globals) {
    invokeObserver(app, observer, event, undefined, triggeringSystemId, triggeringStage, depth);
  }
}

/**
 * Dispatch an entity-targeted trigger: walk every entity-targeted observer
 * bound to `(target, eventCtor)` first, then every global observer for
 * `eventCtor`. Targeted-before-global is the Bevy ordering.
 *
 * @internal
 */
export function dispatchTargetedTrigger(
  app: App,
  event: object,
  target: Entity,
  triggeringSystemId: number,
  triggeringStage: Stage,
  depth: number,
): void {
  const eventCtor = event.constructor as ComponentType;
  const targeted = app.observerRegistry.targetedFor(target, eventCtor);
  for (const observer of targeted) {
    invokeObserver(app, observer, event, target, triggeringSystemId, triggeringStage, depth);
  }
  const globals = app.observerRegistry.globalsFor(eventCtor);
  for (const observer of globals) {
    invokeObserver(app, observer, event, target, triggeringSystemId, triggeringStage, depth);
  }
}

/**
 * Type-level helper exposing the `ParamValues<Ps>` mapping for observer
 * registration. The signature mirrors `App.addSystem`'s shape so observers
 * read the same way as ordinary systems with a `Trigger<E>` as the leading
 * param.
 */
export type ObserverParamValues<Ps extends readonly Param<unknown>[]> = ParamValues<Ps>;
