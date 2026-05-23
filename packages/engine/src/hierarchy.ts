import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';
import { mat4, type Mat4 } from '@retro-engine/math';

import type { EntityCommands } from './commands';
import type { Logger } from './log';
import { composeTransformInto, GlobalTransform, Transform } from './transform';

/**
 * Links an entity to its parent in a transform hierarchy. The propagation
 * system reads this each `'postUpdate'` and composes the entity's local
 * `Transform` with the parent's `GlobalTransform` to produce the entity's
 * world-space `GlobalTransform`.
 *
 * Build hierarchies through the `Commands` sugar
 * (`cmd.spawn(...).withChildren(p => p.spawn(...))`,
 * `cmd.entity(parent).addChild(child)`) rather than constructing `Parent`
 * directly — the sugar also maintains the parent's {@link Children} list.
 *
 * If the referenced entity is no longer live (e.g. removed via a direct
 * `world.despawn` call outside the commands flush) the child becomes an
 * *effective root*: the propagation system treats it as having no parent
 * and emits one `devWarn` per offending entity per frame. Reparent via
 * `cmd.entity(newParent).addChild(child)` to clear. Commands-driven
 * `despawn` cascades through `Children`, so orphans via that path do not
 * occur.
 */
export class Parent {
  constructor(public entity: Entity) {}
}

/**
 * Maintained list of an entity's direct children. The list is kept in sync by
 * the `Commands` hierarchy sugar (`withChildren`, `addChild`, `removeChild`,
 * `despawn`); user code may *read* it freely but should mutate it through
 * `Commands`, not by reaching into `entities` directly.
 *
 * The propagation system does **not** read `Children` — it depends only on
 * `Parent`. `Children` exists for consumer code that needs to walk down the
 * hierarchy (debug viz, gameplay logic) and drives the cascading-despawn
 * lifecycle hook registered by the engine's core plugin.
 */
export class Children {
  constructor(public entities: Entity[] = []) {}
}

/**
 * Callback shape handed to `EntityCommands.withChildren`. Inside the callback,
 * `parent.spawn(...)` queues a child entity with `Parent` already wired and
 * the parent's `Children` list updated. The returned `EntityCommands` can
 * itself call `.withChildren(...)` to seed grandchildren, etc.
 */
export interface ChildBuilder {
  /** Entity id of the parent the builder is bound to. */
  readonly parent: Entity;
  /**
   * Spawn a new entity as a child of this builder's parent. The new entity
   * receives a `Parent` component pointing at the bound parent, and is
   * appended to the parent's `Children` list. Components passed in are
   * inserted alongside `Parent`.
   *
   * Returns an `EntityCommands` for the spawned child — chain
   * `.withChildren(...)` for grandchildren, `.insert(...)` to add more
   * components, etc.
   */
  spawn(...components: ReadonlyArray<object | readonly object[]>): EntityCommands;
}

const tmpLocalMatrix: Mat4 = mat4.create();

interface PropagateRow {
  readonly entity: Entity;
  readonly transform: Transform;
  readonly global: GlobalTransform;
  readonly parent: Parent | undefined;
  readonly depth: number;
}

/**
 * Run one propagation pass over the world: compute each entity's
 * `GlobalTransform.matrix` as `T_parent * T_local` along the `Parent` chain,
 * with roots composing local TRS directly. Single-threaded, depth-sorted by
 * a memoised walk up `Parent`.
 *
 * Orphans (`Parent.entity` is dead or missing `Transform` / `GlobalTransform`)
 * are treated as effective roots; one `Logger.devWarn` fires per offending
 * entity per frame. Cycles in `Parent` chains are detected, the offending
 * entity treated as a root, and one `devWarn` fires per offender per frame.
 *
 * Auto-registered by the `App` constructor in `'postUpdate'`. User code can
 * also invoke this directly against a `World` (for one-off scene preparation
 * or tests).
 *
 * @internal Engine-private; auto-registered by `App`.
 */
export const propagateTransforms = (world: World, logger: Logger): void => {
  const depthByEntity = new Map<Entity, number>();
  const warnedDeadParent = new Set<Entity>();
  const warnedCycle = new Set<Entity>();

  const computeDepth = (entity: Entity, visiting: Set<Entity>): number => {
    const cached = depthByEntity.get(entity);
    if (cached !== undefined) return cached;
    if (visiting.has(entity)) {
      if (!warnedCycle.has(entity)) {
        logger.devWarn(
          `transform: cycle detected in Parent chain at entity ${entity} — treating it as a root`,
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
    const parentAlive = world.hasEntity(parent.entity);
    const parentHasTransform =
      parentAlive && world.getComponent(parent.entity, Transform) !== undefined;
    const parentHasGlobal =
      parentAlive && world.getComponent(parent.entity, GlobalTransform) !== undefined;
    if (!parentAlive || !parentHasTransform || !parentHasGlobal) {
      if (!warnedDeadParent.has(entity)) {
        logger.devWarn(
          `transform: entity ${entity} has Parent ${parent.entity}, but the parent is not a live Transform entity — treating ${entity} as a root`,
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

  const rows: PropagateRow[] = [];
  const visiting = new Set<Entity>();
  for (const [entity, transform, global] of world.query([Transform, GlobalTransform]).entries()) {
    visiting.clear();
    const depth = computeDepth(entity, visiting);
    const parent = world.getComponent(entity, Parent);
    rows.push({ entity, transform, global, parent, depth });
  }
  rows.sort((a, b) => a.depth - b.depth);

  for (const row of rows) {
    if (row.depth === 0) {
      composeTransformInto(
        row.global.matrix,
        row.transform.translation,
        row.transform.rotation,
        row.transform.scale,
      );
      continue;
    }
    // depth > 0 ⇒ Parent exists and its GlobalTransform was validated by computeDepth.
    const parentGlobal = world.getComponent(row.parent!.entity, GlobalTransform)!;
    composeTransformInto(
      tmpLocalMatrix,
      row.transform.translation,
      row.transform.rotation,
      row.transform.scale,
    );
    mat4.multiply(parentGlobal.matrix, tmpLocalMatrix, row.global.matrix);
  }
};

type ChangedTransformsQuery = QueryHandle<readonly [typeof Transform], { readonly changed: readonly (typeof Transform)[] }>;
type ChangedParentsQuery = QueryHandle<readonly [typeof Parent], { readonly changed: readonly (typeof Parent)[] }>;

/**
 * Engine-driven gated propagation. Same composition math as
 * {@link propagateTransforms}, but only touches subtrees whose `Transform`
 * or `Parent` actually moved this frame, and only those entities' descendants.
 *
 * The dirty set is the union of three orthogonal sources, then expanded via
 * BFS over `Children` to cover every descendant of every root:
 *
 * 1. Entities whose `Transform` is `Changed` (local mutations and spawn-frame
 *    entities — spawn-tick stamps both `addedTick` and `changedTick`).
 * 2. Entities whose `Parent` is `Changed` (initial parent assignment via
 *    archetype transition, plus in-place reparenting which calls
 *    `world.markChanged(child, Parent)` from the commands flush).
 * 3. Entities whose `Parent` was just removed — they shift from
 *    `parent_global × local` to `local` and their global is stale even
 *    though their `Transform.changedTick` did not move.
 *
 * Every entity whose `GlobalTransform` is recomputed is reported via
 * `world.markChanged(entity, GlobalTransform)` so downstream consumers can
 * filter on `{ changed: [GlobalTransform] }` (canonical use: a renderer
 * uploading only dirty world matrices to the GPU).
 *
 * On a frame with no dirty roots, returns immediately without scanning rows.
 *
 * @internal Engine-private; registered by `CorePlugin` in `'postUpdate'`.
 */
export const propagateTransformsGated = (
  world: World,
  logger: Logger,
  changedTransforms: ChangedTransformsQuery,
  changedParents: ChangedParentsQuery,
  removedParents: Iterable<Entity>,
): void => {
  const dirty = new Set<Entity>();

  for (const [entity] of changedTransforms.entries()) dirty.add(entity);
  for (const [entity] of changedParents.entries()) dirty.add(entity);
  for (const entity of removedParents) {
    if (world.hasEntity(entity)) dirty.add(entity);
  }

  if (dirty.size === 0) return;

  // BFS-expand the dirty set to include every descendant via Children lists.
  // Conservative — non-Transform intermediates are visited so their Transform
  // descendants are reached; the compose loop filters by Transform presence.
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
          `transform: cycle detected in Parent chain at entity ${entity} — treating it as a root`,
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
    const parentAlive = world.hasEntity(parent.entity);
    const parentHasTransform =
      parentAlive && world.getComponent(parent.entity, Transform) !== undefined;
    const parentHasGlobal =
      parentAlive && world.getComponent(parent.entity, GlobalTransform) !== undefined;
    if (!parentAlive || !parentHasTransform || !parentHasGlobal) {
      if (!warnedDeadParent.has(entity)) {
        logger.devWarn(
          `transform: entity ${entity} has Parent ${parent.entity}, but the parent is not a live Transform entity — treating ${entity} as a root`,
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

  const rows: PropagateRow[] = [];
  const visiting = new Set<Entity>();
  for (const entity of dirty) {
    const transform = world.getComponent(entity, Transform);
    if (!transform) continue;
    const global = world.getComponent(entity, GlobalTransform);
    if (!global) continue;
    visiting.clear();
    const depth = computeDepth(entity, visiting);
    const parent = world.getComponent(entity, Parent);
    rows.push({ entity, transform, global, parent, depth });
  }
  if (rows.length === 0) return;
  rows.sort((a, b) => a.depth - b.depth);

  for (const row of rows) {
    if (row.depth === 0) {
      composeTransformInto(
        row.global.matrix,
        row.transform.translation,
        row.transform.rotation,
        row.transform.scale,
      );
    } else {
      // depth > 0 ⇒ Parent exists and its GlobalTransform was validated by computeDepth.
      // If the parent is in the dirty set its global was already composed earlier
      // in this pass (depth-ascending sort); otherwise we read its prior value,
      // which is up-to-date because nothing in the parent's chain was dirty.
      const parentGlobal = world.getComponent(row.parent!.entity, GlobalTransform)!;
      composeTransformInto(
        tmpLocalMatrix,
        row.transform.translation,
        row.transform.rotation,
        row.transform.scale,
      );
      mat4.multiply(parentGlobal.matrix, tmpLocalMatrix, row.global.matrix);
    }
    world.markChanged(row.entity, GlobalTransform);
  }
};
