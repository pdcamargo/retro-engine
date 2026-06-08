import type { SerializedObserverBinding } from '../scene/scene-data';

import type { ObserverHandler } from './handler';
import type { ObserverHandlerRegistry } from './handler-registry';

/**
 * Resolve a scene entity's observer bindings to their registered handlers, in
 * order. Each binding names a handler; the handler carries the event it observes
 * and the body to run.
 *
 * Throws if a binding names an unregistered handler — a missing handler is an
 * authoring error (the bound behavior would silently never fire), not a
 * droppable component.
 *
 * @internal Used by `spawnScene` to attach `SerializedEntity.observers`.
 */
export const resolveObserverBindings = (
  handlers: ObserverHandlerRegistry,
  bindings: readonly SerializedObserverBinding[],
): ObserverHandler[] => {
  const out: ObserverHandler[] = [];
  for (const binding of bindings) {
    const handler = handlers.get(binding.handler);
    if (handler === undefined) {
      throw new Error(
        `observer binding: scene references unregistered observer handler '${binding.handler}'`,
      );
    }
    out.push(handler);
  }
  return out;
};
