import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';

import { Children, Parent } from '../hierarchy';
import type { Logger } from '../log';
import { InheritedVisibility, Visibility } from './visibility';

type ChangedVisibilityQuery = QueryHandle<
  readonly [typeof Visibility],
  { readonly changed: readonly (typeof Visibility)[] }
>;
type ChangedParentsQuery = QueryHandle<
  readonly [typeof Parent],
  { readonly changed: readonly (typeof Parent)[] }
>;

/**
 * `'postUpdate'` system: walk the visibility hierarchy starting from every
 * entity whose {@link Visibility} or {@link Parent} changed this frame, and
 * write the resolved per-entity {@link InheritedVisibility.visible}. Same
 * dirty-set + BFS-expand-via-Children shape as the transform-propagation
 * system in `hierarchy.ts`, but the per-entity composition is a three-state
 * override walk instead of a matrix multiply.
 *
 * Resolution rules (matching the `Visibility.mode` doc):
 *
 * - `'Hidden'` → `InheritedVisibility.visible = false`. Descendants with
 *   `'Inherited'` see this and inherit the hidden state.
 * - `'Visible'` → `InheritedVisibility.visible = true`. Overrides a hidden
 *   ancestor.
 * - `'Inherited'` (or no {@link Visibility} component at all) → resolves to
 *   the parent's `InheritedVisibility.visible`, or `true` at a root.
 *
 * Orphaned parents (a `Parent` whose target entity is no longer live) are
 * treated as effective roots; the child resolves with no ancestor context
 * and one `Logger.devWarn` fires per orphan per frame. Cycles are detected
 * and broken at the first re-visit, with one `devWarn` per offending entity
 * per frame.
 *
 * `InheritedVisibility` is `world.markChanged`-stamped only when the
 * resolved value actually moved, so downstream `{ changed: [InheritedVisibility] }`
 * filters fire only on real edges.
 *
 * @internal Engine-private; registered by `VisibilityPlugin` in `'postUpdate'`.
 */
export const visibilityPropagateSystem = (
  world: World,
  logger: Logger,
  changedVisibility: ChangedVisibilityQuery,
  changedParents: ChangedParentsQuery,
  removedParents: Iterable<Entity>,
): void => {
  const dirty = new Set<Entity>();

  for (const [entity] of changedVisibility.entries()) dirty.add(entity);
  for (const [entity] of changedParents.entries()) dirty.add(entity);
  for (const entity of removedParents) {
    if (world.hasEntity(entity)) dirty.add(entity);
  }

  if (dirty.size === 0) return;

  const stack = [...dirty];
  while (stack.length > 0) {
    const e = stack.pop()!;
    const children = world.getComponent(e, Children);
    if (!children) continue;
    for (const c of children.entities) {
      if (!world.hasEntity(c)) continue;
      if (dirty.has(c)) continue;
      dirty.add(c);
      stack.push(c);
    }
  }

  const depthByEntity = new Map<Entity, number>();
  const warnedDeadParent = new Set<Entity>();
  const warnedCycle = new Set<Entity>();

  const computeDepth = (entity: Entity, visiting: Set<Entity>): number => {
    const cached = depthByEntity.get(entity);
    if (cached !== undefined) return cached;
    if (visiting.has(entity)) {
      if (!warnedCycle.has(entity)) {
        logger.devWarn(
          `visibility: cycle detected in Parent chain at entity ${entity} — treating it as a root`,
        );
        warnedCycle.add(entity);
      }
      depthByEntity.set(entity, 0);
      return 0;
    }
    const parent = world.getComponent(entity, Parent);
    if (!parent) {
      depthByEntity.set(entity, 0);
      return 0;
    }
    if (!world.hasEntity(parent.entity)) {
      if (!warnedDeadParent.has(entity)) {
        logger.devWarn(
          `visibility: entity ${entity} has Parent ${parent.entity}, but the parent is not live — treating ${entity} as a root`,
        );
        warnedDeadParent.add(entity);
      }
      depthByEntity.set(entity, 0);
      return 0;
    }
    visiting.add(entity);
    const parentDepth = computeDepth(parent.entity, visiting);
    visiting.delete(entity);
    const depth = parentDepth + 1;
    depthByEntity.set(entity, depth);
    return depth;
  };

  interface VisibilityRow {
    readonly entity: Entity;
    readonly inherited: InheritedVisibility;
    readonly depth: number;
  }
  const rows: VisibilityRow[] = [];
  const visiting = new Set<Entity>();
  for (const entity of dirty) {
    const inherited = world.getComponent(entity, InheritedVisibility);
    if (!inherited) continue;
    visiting.clear();
    const depth = computeDepth(entity, visiting);
    rows.push({ entity, inherited, depth });
  }
  if (rows.length === 0) return;
  rows.sort((a, b) => a.depth - b.depth);

  for (const row of rows) {
    const visibility = world.getComponent(row.entity, Visibility);
    const mode = visibility?.mode ?? 'Inherited';
    let effective: boolean;
    if (mode === 'Hidden') {
      effective = false;
    } else if (mode === 'Visible') {
      effective = true;
    } else {
      const parent = world.getComponent(row.entity, Parent);
      if (parent && world.hasEntity(parent.entity)) {
        const parentInherited = world.getComponent(parent.entity, InheritedVisibility);
        effective = parentInherited?.visible ?? true;
      } else {
        effective = true;
      }
    }
    if (row.inherited.visible !== effective) {
      row.inherited.visible = effective;
      world.markChanged(row.entity, InheritedVisibility);
    }
  }
};
