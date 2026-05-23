import type { ComponentType, Entity } from '@retro-engine/ecs';

import type { Param } from './system-param';

const removedComponentsCache = new WeakMap<object, Param<Iterable<Entity>>>();

/**
 * Declares a dependency on the per-frame stream of entities that lost a
 * component of type `ctor` since the calling system's last run. Bevy parallel:
 * `RemovedComponents<T>`.
 *
 * The resolved value is a lazy {@link Iterable} over the entity ids whose
 * `ctor` component was removed (either via `world.entity(e).remove(ctor)` or
 * via `world.despawn(e)`, which buffers one entry per component the entity
 * carried). Removal entries with a tick strictly greater than the system's
 * `lastSeenTick` are yielded; older entries are skipped.
 *
 * **v1 lifetime.** The removed buffer is drained at frame boundary, after
 * every stage runs (Main + FixedMain + render). A removal observed in
 * frame F is visible to all systems that run in frame F (regardless of stage
 * order — systems running later in F can still observe it), but is gone in
 * frame F+1. A system whose `runIf` returns false for a whole frame loses
 * that frame's removals; cross-frame accumulation for `RemovedComponents` is
 * a documented v1 limitation (see ADR-0012).
 *
 * Tokens are cached per constructor: `RemovedComponents(Foo) === RemovedComponents(Foo)`.
 *
 * @example
 * ```ts
 * app.addSystem('postUpdate', [RemovedComponents(Player)], (gone) => {
 *   for (const entity of gone) console.log(`player ${entity} left`);
 * });
 * ```
 */
export function RemovedComponents(ctor: ComponentType): Param<Iterable<Entity>> {
  const cached = removedComponentsCache.get(ctor);
  if (cached) return cached;
  const param: Param<Iterable<Entity>> = {
    resolve(ctx) {
      const sinceTick = ctx.lastSeenTick;
      const entries = ctx.world.getRemovedComponents(ctor);
      return {
        *[Symbol.iterator](): IterableIterator<Entity> {
          for (const e of entries) {
            if (e.tick > sinceTick) yield e.entity;
          }
        },
      };
    },
  };
  removedComponentsCache.set(ctor, param);
  return param;
}
