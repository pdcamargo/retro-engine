import type { ComponentType, Entity } from '@retro-engine/ecs';

import type { ChildBuilder } from './hierarchy';
import { Children, Parent } from './hierarchy';
import type { App } from './index';
import type { Param, ResolveCtx, SystemId } from './system-param';

/**
 * One enqueued command. The discriminant `kind` selects the dispatcher arm in
 * {@link applyCommandOp}. Not part of the public API — consumers interact with
 * commands through the {@link CommandsHandle} surface.
 *
 * @internal
 */
export type CommandOp =
  | { kind: 'spawn'; entity: Entity; components: readonly object[] }
  | { kind: 'despawn'; entity: Entity }
  | { kind: 'insert'; entity: Entity; components: readonly object[] }
  | { kind: 'remove'; entity: Entity; type: ComponentType }
  | { kind: 'insertResource'; value: object }
  | { kind: 'removeResource'; type: ComponentType }
  | { kind: 'appendChild'; parent: Entity; child: Entity }
  | { kind: 'detachChild'; parent: Entity; child: Entity }
  | { kind: 'despawnSubtree'; root: Entity };

const flattenComponents = (
  parts: ReadonlyArray<object | readonly object[]>,
): object[] => {
  const flat: object[] = [];
  for (const c of parts) {
    if (Array.isArray(c)) flat.push(...c);
    else flat.push(c as object);
  }
  return flat;
};

/**
 * Apply one queued command to the world / resources. Routes through the same
 * public `World` / `App` methods user code calls directly — so resource
 * change-frame stamps, archetype transitions, and tick columns behave the
 * same as direct mutations. Carve-outs documented per-arm.
 *
 * @internal
 */
export const applyCommandOp = (op: CommandOp, app: App): void => {
  switch (op.kind) {
    case 'spawn': {
      app.world.spawnReserved(op.entity, op.components);
      return;
    }
    case 'despawn': {
      app.world.despawn(op.entity);
      return;
    }
    case 'insert': {
      if (!app.world.hasEntity(op.entity)) {
        app.logger.devWarn(
          `Commands.insert: entity ${op.entity} no longer exists at flush — skipping insert of ${op.components.length} component(s)`,
        );
        return;
      }
      app.world.insertBundle(op.entity, op.components);
      return;
    }
    case 'remove': {
      app.world.removeComponent(op.entity, op.type);
      return;
    }
    case 'insertResource': {
      app.insertResource(op.value);
      return;
    }
    case 'removeResource': {
      // `App.removeResource` types its constructor argument with `any[]` rest
      // params; `ComponentType` uses `never[]`. The two are compatible at
      // runtime but TypeScript treats constructor parameter lists invariantly
      // here, hence the cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.removeResource(op.type as new (...a: any[]) => object);
      return;
    }
    case 'appendChild': {
      if (!app.world.hasEntity(op.parent)) {
        app.logger.devWarn(
          `Commands.addChild: parent ${op.parent} is not live at flush — child ${op.child} not parented`,
        );
        return;
      }
      if (!app.world.hasEntity(op.child)) {
        app.logger.devWarn(
          `Commands.addChild: child ${op.child} is not live at flush — not parented to ${op.parent}`,
        );
        return;
      }
      // If child currently has a different parent, detach from that parent's Children list.
      const existingParent = app.world.getComponent(op.child, Parent);
      if (existingParent && existingParent.entity !== op.parent) {
        const oldChildren = app.world.getComponent(existingParent.entity, Children);
        if (oldChildren) {
          const idx = oldChildren.entities.indexOf(op.child);
          if (idx >= 0) oldChildren.entities.splice(idx, 1);
        }
      }
      // Wire child.Parent = parent.
      if (existingParent) {
        existingParent.entity = op.parent;
      } else {
        app.world.insertBundle(op.child, [new Parent(op.parent)]);
      }
      // Append child to parent.Children (creating the component if absent).
      const children = app.world.getComponent(op.parent, Children);
      if (children) {
        if (!children.entities.includes(op.child)) {
          children.entities.push(op.child);
        }
      } else {
        app.world.insertBundle(op.parent, [new Children([op.child])]);
      }
      return;
    }
    case 'detachChild': {
      const parentChildren = app.world.getComponent(op.parent, Children);
      if (parentChildren) {
        const idx = parentChildren.entities.indexOf(op.child);
        if (idx >= 0) parentChildren.entities.splice(idx, 1);
      }
      // Only clear child.Parent if it still points to op.parent (defends against races
      // where the child was reparented elsewhere between enqueue and flush).
      const childParent = app.world.getComponent(op.child, Parent);
      if (childParent && childParent.entity === op.parent) {
        app.world.removeComponent(op.child, Parent);
      }
      return;
    }
    case 'despawnSubtree': {
      if (!app.world.hasEntity(op.root)) return;
      // Detach the root from its own parent's Children list, if any.
      const rootParent = app.world.getComponent(op.root, Parent);
      if (rootParent) {
        const parentChildren = app.world.getComponent(rootParent.entity, Children);
        if (parentChildren) {
          const idx = parentChildren.entities.indexOf(op.root);
          if (idx >= 0) parentChildren.entities.splice(idx, 1);
        }
      }
      // Walk the subtree via Children. Use a stack; despawn order doesn't matter.
      const stack: Entity[] = [op.root];
      const toDespawn: Entity[] = [];
      while (stack.length > 0) {
        const e = stack.pop()!;
        if (!app.world.hasEntity(e)) continue;
        toDespawn.push(e);
        const children = app.world.getComponent(e, Children);
        if (children) {
          for (const child of children.entities) {
            if (app.world.hasEntity(child)) stack.push(child);
          }
        }
      }
      for (const e of toDespawn) app.world.despawn(e);
      return;
    }
  }
};

/**
 * Builder returned by {@link CommandsHandle.entity} and by
 * {@link CommandsHandle.spawn}. Chained calls enqueue operations on the bound
 * entity; the operations apply at the next flush, not when the chain method
 * returns. Use it to queue insert / remove / despawn against an existing
 * entity (or against a freshly-reserved id from `cmd.spawn(...)` whose row
 * has not yet been allocated — the spawn op applies before the chained ops
 * because it was enqueued first).
 *
 * Hierarchy-building methods (`withChildren`, `addChild`, `removeChild`,
 * `despawnRecursive`) maintain the `Parent` and `Children` components
 * automatically; consumers do not need to import those classes to wire
 * hierarchies.
 */
export interface EntityCommands {
  /** The entity id this builder targets. */
  readonly id: Entity;
  /**
   * Enqueue insertion of one or more components on this entity. Accepts
   * variadic instances or a single array bundle, mirroring `World.spawn`.
   * Required-component dependencies are resolved at flush.
   */
  insert(...components: ReadonlyArray<object | readonly object[]>): EntityCommands;
  /** Enqueue removal of one or more components by class. */
  remove(...types: ComponentType[]): EntityCommands;
  /** Enqueue despawn of this entity. Does **not** cascade to children — use {@link despawnRecursive}. */
  despawn(): void;
  /**
   * Build a hierarchy of children under this entity. Inside the callback,
   * each `parent.spawn(...)` reserves a fresh child entity, attaches it via
   * a `Parent` component, and appends it to this entity's `Children` list.
   *
   * The `ChildBuilder.spawn(...)` returns an `EntityCommands` for the new
   * child, so nested `withChildren` calls build grandchildren naturally.
   */
  withChildren(cb: (parent: ChildBuilder) => void): EntityCommands;
  /**
   * Attach an existing entity as a child of this entity. If the child
   * already has a parent, it is detached from the previous parent's
   * `Children` list before being appended here.
   */
  addChild(child: Entity): EntityCommands;
  /**
   * Detach a child entity from this entity. Removes the child from this
   * entity's `Children` list and clears the child's `Parent` component
   * (only if it still points at this entity).
   */
  removeChild(child: Entity): EntityCommands;
  /**
   * Despawn this entity along with every descendant reachable through
   * `Children`. Detaches the root from its own parent's `Children` list, if
   * any. Dead descendants are skipped silently.
   */
  despawnRecursive(): void;
}

/**
 * Per-system handle for deferred structural mutations. Every method enqueues a
 * command into the calling system's buffer; the buffer drains automatically
 * immediately after the system's function returns.
 *
 * The handle exposes no `flush()` method — calling flush from inside a system
 * holding a live `Query` iterator is the foot-gun this buffer exists to
 * prevent. For same-system "see my own writes" needs, split into two systems
 * with `before` / `after` ordering. For orchestration callers (tests, plugin
 * lifecycle hooks), use {@link App.flushCommands}.
 *
 * `spawn` returns an {@link EntityCommands} synchronously: the entity id is
 * reserved at enqueue time (available via `.id`), the row is allocated at
 * flush. The id can be passed to subsequent commands in the same buffer; the
 * returned builder can chain `.insert(...)`, `.withChildren(...)`, etc.
 */
export interface CommandsHandle {
  /**
   * Enqueue spawn of a new entity with zero or more components. Returns an
   * {@link EntityCommands} bound to the freshly-reserved entity id (the id
   * is accessible via `.id`); the row is allocated at flush. Accepts
   * components as variadic instances or as a single array bundle, mirroring
   * `World.spawn`.
   */
  spawn(...components: ReadonlyArray<object | readonly object[]>): EntityCommands;
  /** Enqueue despawn of an entity. Silent at flush if the entity is already gone. */
  despawn(entity: Entity): void;
  /** Bind a builder to an entity for chained insert / remove / despawn / hierarchy ops. */
  entity(entity: Entity): EntityCommands;
  /**
   * Enqueue insertion (or replacement) of a resource. Applied at flush via
   * {@link App.insertResource}, which stamps `Time.frame` on the resource's
   * change-frame slot so `resourceChanged` filters fire on the flush frame.
   */
  insertResource<T extends object>(value: T): void;
  /** Enqueue removal of a resource by class. Silent at flush if the resource is absent. */
  removeResource(type: ComponentType): void;
}

class EntityCommandsImpl implements EntityCommands {
  constructor(
    private readonly handle: CommandsHandleImpl,
    readonly id: Entity,
  ) {}

  insert(...components: ReadonlyArray<object | readonly object[]>): EntityCommands {
    const flat = flattenComponents(components);
    if (flat.length === 0) return this;
    this.handle.enqueue({ kind: 'insert', entity: this.id, components: flat });
    return this;
  }

  remove(...types: ComponentType[]): EntityCommands {
    for (const t of types) {
      this.handle.enqueue({ kind: 'remove', entity: this.id, type: t });
    }
    return this;
  }

  despawn(): void {
    this.handle.enqueue({ kind: 'despawn', entity: this.id });
  }

  withChildren(cb: (parent: ChildBuilder) => void): EntityCommands {
    const parentId = this.id;
    const handle = this.handle;
    const builder: ChildBuilder = {
      parent: parentId,
      spawn(...components: ReadonlyArray<object | readonly object[]>): EntityCommands {
        const child = handle.spawn(...components);
        handle.enqueue({ kind: 'appendChild', parent: parentId, child: child.id });
        return child;
      },
    };
    cb(builder);
    return this;
  }

  addChild(child: Entity): EntityCommands {
    this.handle.enqueue({ kind: 'appendChild', parent: this.id, child });
    return this;
  }

  removeChild(child: Entity): EntityCommands {
    this.handle.enqueue({ kind: 'detachChild', parent: this.id, child });
    return this;
  }

  despawnRecursive(): void {
    this.handle.enqueue({ kind: 'despawnSubtree', root: this.id });
  }
}

class CommandsHandleImpl implements CommandsHandle {
  constructor(
    private readonly app: App,
    private readonly systemId: SystemId,
  ) {}

  enqueue(op: CommandOp): void {
    this.app.getCommandsBuffer(this.systemId).push(op);
  }

  spawn(...components: ReadonlyArray<object | readonly object[]>): EntityCommands {
    const flat = flattenComponents(components);
    const entity = this.app.world.reserveEntity();
    this.enqueue({ kind: 'spawn', entity, components: flat });
    return new EntityCommandsImpl(this, entity);
  }

  despawn(entity: Entity): void {
    this.enqueue({ kind: 'despawn', entity });
  }

  entity(entity: Entity): EntityCommands {
    return new EntityCommandsImpl(this, entity);
  }

  insertResource<T extends object>(value: T): void {
    this.enqueue({ kind: 'insertResource', value });
  }

  removeResource(type: ComponentType): void {
    this.enqueue({ kind: 'removeResource', type });
  }
}

/**
 * System-param token for the deferred-mutation command buffer. Resolves to a
 * fresh per-system {@link CommandsHandle}; the buffer behind the handle is
 * keyed by the calling system's identity and drained immediately after the
 * system's function returns.
 *
 * @example
 * ```ts
 * app.addSystem('update', [Commands, Query([Position])], (cmd, q) => {
 *   for (const [pos] of q) {
 *     if (pos.x > 1000) cmd.spawn(new Position(0, 0));  // queued
 *   }
 *   // queued spawns are applied here, after the function returns
 * });
 * ```
 */
export const Commands: Param<CommandsHandle> = {
  resolve(ctx: ResolveCtx): CommandsHandle {
    return new CommandsHandleImpl(ctx.app, ctx.systemId);
  },
};
