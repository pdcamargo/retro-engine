import type { Entity, World } from '@retro-engine/ecs';
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
 * If the referenced entity is no longer live (despawned without a recursive
 * cascade) the child becomes an *effective root*: the propagation system
 * treats it as having no parent and emits one `devWarn` per offending entity
 * per frame. Reparent via `cmd.entity(newParent).addChild(child)` to clear.
 */
export class Parent {
  constructor(public entity: Entity) {}
}

/**
 * Maintained list of an entity's direct children. The list is kept in sync by
 * the `Commands` hierarchy sugar (`withChildren`, `addChild`, `removeChild`,
 * `despawnRecursive`); user code may *read* it freely but should mutate it
 * through `Commands`, not by reaching into `entities` directly.
 *
 * The propagation system does **not** read `Children` — it depends only on
 * `Parent`. `Children` exists for consumer code that needs to walk down the
 * hierarchy (debug viz, gameplay logic) and for the recursive-despawn path.
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
