import type { Archetype } from './archetype';
import type { ComponentType, Entity } from './types';

/**
 * One entry in {@link World.takeRemovedComponents}'s output buffer: the entity
 * that lost a component, and the mutation tick at the moment of removal.
 *
 * The component type is the key in the buffer's map — `RemovedEntry` does not
 * repeat it. Consumers compare `tick > systemLastSeenTick` to scope the entry
 * to "removed since I last looked."
 */
export interface RemovedEntry {
  readonly entity: Entity;
  readonly tick: number;
}

/**
 * Whether the given row's `type` was last marked changed strictly after
 * `sinceTick`. The archetype must carry `type`; the caller is responsible for
 * the type-set check.
 *
 * @internal
 */
export const isChangedSince = (
  archetype: Archetype,
  type: ComponentType,
  row: number,
  sinceTick: number,
): boolean => {
  const col = archetype.changedTickColumns.get(type);
  if (!col) return false;
  return col[row]! > sinceTick;
};

/**
 * Whether the given row's `type` was added to the archetype strictly after
 * `sinceTick`. The archetype must carry `type`; the caller is responsible for
 * the type-set check.
 *
 * @internal
 */
export const isAddedSince = (
  archetype: Archetype,
  type: ComponentType,
  row: number,
  sinceTick: number,
): boolean => {
  const col = archetype.addedTickColumns.get(type);
  if (!col) return false;
  return col[row]! > sinceTick;
};

/**
 * Overwrite the `changedTick` column entry for `(type, row)` in `archetype`.
 * Used by `World.markChanged` to record an in-place mutation hint.
 *
 * @internal
 */
export const writeChangedTick = (
  archetype: Archetype,
  type: ComponentType,
  row: number,
  tick: number,
): void => {
  const col = archetype.changedTickColumns.get(type);
  if (!col) return;
  col[row] = tick;
};
