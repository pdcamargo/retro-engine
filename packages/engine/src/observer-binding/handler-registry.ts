import type { Param } from '../system-param';

import type { ObserverHandler } from './handler';

/**
 * Per-App store of registered {@link ObserverHandler}s, keyed by their stable
 * name. An App resource (inserted at construction); a plugin registers its
 * handlers from `build()` via `app.registerObserverHandler(...)`. Name lookup is
 * what lets a scene attach an observer to an entity by referencing the handler
 * name alone — the handler carries the event and the body.
 */
export class ObserverHandlerRegistry {
  private readonly byName = new Map<string, ObserverHandler>();

  /**
   * Register a handler under its stable name. Throws if the name is already
   * taken — names are the identity a scene references, so collisions are a bug.
   */
  register<E extends object, Ps extends readonly Param<unknown>[]>(
    handler: ObserverHandler<E, Ps>,
  ): ObserverHandler<E, Ps> {
    if (this.byName.has(handler.name)) {
      throw new Error(
        `observer binding: an observer handler named '${handler.name}' is already registered`,
      );
    }
    this.byName.set(handler.name, handler as unknown as ObserverHandler);
    return handler;
  }

  /** Look up a registered handler by name, or `undefined` if none is registered. */
  get(name: string): ObserverHandler | undefined {
    return this.byName.get(name);
  }

  /** Whether a handler is registered under `name`. */
  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Iterate every registered handler. */
  *handlers(): IterableIterator<ObserverHandler> {
    yield* this.byName.values();
  }
}
