import type { ComponentType, Entity } from '@retro-engine/ecs';

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
  | { kind: 'removeResource'; type: ComponentType };

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
 * same as direct mutations. Two carve-outs:
 *
 * - `insert` against a dead entity emits a `devWarn` and is skipped, rather
 *   than throwing as `World.insertBundle` would.
 * - `removeResource` on a missing resource is a silent no-op (already the
 *   behaviour of `App.removeResource`).
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
  }
};

/**
 * Builder returned by {@link CommandsHandle.entity}. Chained calls enqueue
 * operations on the bound entity; the operations apply at the next flush, not
 * when the chain method returns. Use it to queue insert / remove / despawn
 * against an existing entity (or against a freshly-reserved id from
 * `cmd.spawn(...)` whose row has not yet been allocated — the spawn op
 * applies before the chained ops because it was enqueued first).
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
  /** Enqueue despawn of this entity. */
  despawn(): void;
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
 * `spawn` returns an `Entity` synchronously: the id is reserved at enqueue
 * time, the row is allocated at flush. The id can be passed to subsequent
 * commands in the same buffer.
 */
export interface CommandsHandle {
  /**
   * Enqueue spawn of a new entity with zero or more components. Returns the
   * freshly-reserved entity id immediately; the row is allocated at flush.
   * Accepts components as variadic instances or as a single array bundle,
   * mirroring `World.spawn`.
   */
  spawn(...components: ReadonlyArray<object | readonly object[]>): Entity;
  /** Enqueue despawn of an entity. Silent at flush if the entity is already gone. */
  despawn(entity: Entity): void;
  /** Bind a builder to an entity for chained insert / remove / despawn. */
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
}

class CommandsHandleImpl implements CommandsHandle {
  constructor(
    private readonly app: App,
    private readonly systemId: SystemId,
  ) {}

  enqueue(op: CommandOp): void {
    this.app.getCommandsBuffer(this.systemId).push(op);
  }

  spawn(...components: ReadonlyArray<object | readonly object[]>): Entity {
    const flat = flattenComponents(components);
    const entity = this.app.world.reserveEntity();
    this.enqueue({ kind: 'spawn', entity, components: flat });
    return entity;
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
