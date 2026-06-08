import type { ComponentType } from '@retro-engine/ecs';

import type { Param, ParamValues } from '../system-param';

/**
 * A named, reusable observer body bound to a single event type. Registering a
 * handler bundles everything the runtime needs to attach it to an entity — the
 * event it listens for, the params its body resolves, and the function to run —
 * under a stable name a scene can reference.
 *
 * Handlers are plain data + a closure — there is no base class to extend. Create
 * one with {@link defineObserverHandler}.
 */
export interface ObserverHandler<
  E extends object = object,
  Ps extends readonly Param<unknown>[] = readonly Param<unknown>[],
> {
  /** Stable, minification-safe name. The key a scene references and the registry stores. */
  readonly name: string;
  /** The event class this handler observes. Triggers of this class fire `run`. */
  readonly event: ComponentType<E>;
  /** The params resolved per trigger and passed to `run`, in order. */
  readonly params: Ps;
  /** The observer body, invoked with one resolved value per param. */
  run(...args: ParamValues<Ps>): void;
}

/**
 * The shape passed to {@link defineObserverHandler}. Identical to
 * {@link ObserverHandler}; the type params are inferred so `run` receives
 * fully-typed values.
 */
export interface ObserverHandlerDefinition<
  E extends object,
  Ps extends readonly Param<unknown>[],
> {
  /** Stable, minification-safe name. */
  readonly name: string;
  /** The event class this handler observes. */
  readonly event: ComponentType<E>;
  /** The params resolved per trigger and passed to `run`, in order. */
  readonly params: Ps;
  /** The observer body, invoked with one resolved value per param. */
  run(...args: ParamValues<Ps>): void;
}

/**
 * Define a named observer handler. The param tuple is inferred, so `run`
 * receives fully-typed values (e.g. a leading `Trigger<E>` handle).
 *
 * Register the result with `App.registerObserverHandler` so a scene can attach
 * it to an entity by name.
 *
 * @example
 * ```ts
 * class Clicked { constructor(public button = 0) {} }
 * const recolor = defineObserverHandler({
 *   name: 'recolor',
 *   event: Clicked,
 *   params: [Trigger(Clicked), Commands],
 *   run: (t, cmd) => cmd.entity(t.entity()!).insert(new Tint(1, 0, 0)),
 * });
 * ```
 */
export const defineObserverHandler = <
  E extends object,
  const Ps extends readonly Param<unknown>[],
>(
  def: ObserverHandlerDefinition<E, Ps>,
): ObserverHandler<E, Ps> => ({
  name: def.name,
  event: def.event,
  params: def.params,
  run: def.run,
});
