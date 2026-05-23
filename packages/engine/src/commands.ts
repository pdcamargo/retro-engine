import type { ComponentType, Entity } from '@retro-engine/ecs';

import type { HookCtx } from './component-hooks';
import { dispatchLifecycleObservers } from './component-hooks';
import type { ChildBuilder } from './hierarchy';
import { Children, Parent } from './hierarchy';
import type { App } from './index';
import { dispatchGlobalTrigger, dispatchTargetedTrigger, MAX_TRIGGER_DEPTH } from './observers';
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
  | { kind: 'triggerGlobal'; event: object; depth: number }
  | { kind: 'triggerEntity'; event: object; target: Entity; depth: number }
  | {
      kind: 'attachObserver';
      target: Entity;
      eventCtor: ComponentType;
      params: ReadonlyArray<Param<unknown>>;
      fn: (...args: unknown[]) => void;
    };

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

const userPassedTypes = (components: readonly object[]): Map<ComponentType, object> => {
  const m = new Map<ComponentType, object>();
  for (const c of components) m.set(c.constructor as ComponentType, c);
  return m;
};

const cmdHandleFor = (app: App, systemId: SystemId): CommandsHandle =>
  new CommandsHandleImpl(app, systemId);

/**
 * Spawn the entity (allocating archetype storage for the previously-reserved
 * id) and fan out lifecycle hooks. Hooks fire only for user-passed component
 * types — `onAdd` for every passed type (each is new to the entity by
 * definition of spawn), then `onInsert` for every passed type. Required
 * components expanded by `resolveBundle` are not auto-hooked in v1; consumers
 * who want hooks on those types register them on a passed component or
 * provide their own bundle.
 *
 * @internal
 */
const applySpawnWithHooks = (
  app: App,
  entity: Entity,
  components: readonly object[],
  triggeringSystemId: SystemId,
): void => {
  const userTypes = userPassedTypes(components);
  app.world.spawnReserved(entity, components);
  const cmdHandle = cmdHandleFor(app, triggeringSystemId);
  const registry = app.componentHookRegistry;
  for (const type of userTypes.keys()) {
    const value = app.world.getComponent(entity, type);
    if (value === undefined) continue;
    dispatchLifecycleObservers(app, 'onAdd', type, triggeringSystemId, entity, value);
    if (!registry.has(type, 'onAdd')) continue;
    registry.dispatch(type, 'onAdd', { world: app.world, commands: cmdHandle, entity, value } as HookCtx<unknown>);
  }
  for (const type of userTypes.keys()) {
    const value = app.world.getComponent(entity, type);
    if (value === undefined) continue;
    dispatchLifecycleObservers(app, 'onInsert', type, triggeringSystemId, entity, value);
    if (!registry.has(type, 'onInsert')) continue;
    registry.dispatch(type, 'onInsert', { world: app.world, commands: cmdHandle, entity, value } as HookCtx<unknown>);
  }
};

/**
 * Insert a bundle on a live entity and fan out lifecycle hooks. Pre-mutation:
 * fires `onReplace` (with the OLD value) for every user-passed type that the
 * entity already carried. Post-mutation: fires `onAdd` for newly-added types,
 * then `onInsert` for every user-passed type.
 *
 * Throws nothing of its own — propagates any throw from `world.insertBundle`
 * or a hook body up to the commands flush.
 *
 * @internal
 */
const applyInsertWithHooks = (
  app: App,
  entity: Entity,
  components: readonly object[],
  triggeringSystemId: SystemId,
): void => {
  const userTypes = userPassedTypes(components);
  const cmdHandle = cmdHandleFor(app, triggeringSystemId);
  const registry = app.componentHookRegistry;

  const replaced: Array<{ type: ComponentType; oldValue: unknown }> = [];
  const newlyAdded: ComponentType[] = [];
  for (const type of userTypes.keys()) {
    if (app.world.has(entity, type)) {
      replaced.push({ type, oldValue: app.world.getComponent(entity, type) });
    } else {
      newlyAdded.push(type);
    }
  }

  for (const { type, oldValue } of replaced) {
    if (oldValue === undefined) continue;
    dispatchLifecycleObservers(app, 'onReplace', type, triggeringSystemId, entity, oldValue);
    if (!registry.has(type, 'onReplace')) continue;
    registry.dispatch(type, 'onReplace', { world: app.world, commands: cmdHandle, entity, value: oldValue } as HookCtx<unknown>);
  }

  app.world.insertBundle(entity, components);

  for (const type of newlyAdded) {
    const value = app.world.getComponent(entity, type);
    if (value === undefined) continue;
    dispatchLifecycleObservers(app, 'onAdd', type, triggeringSystemId, entity, value);
    if (!registry.has(type, 'onAdd')) continue;
    registry.dispatch(type, 'onAdd', { world: app.world, commands: cmdHandle, entity, value } as HookCtx<unknown>);
  }
  for (const type of userTypes.keys()) {
    const value = app.world.getComponent(entity, type);
    if (value === undefined) continue;
    dispatchLifecycleObservers(app, 'onInsert', type, triggeringSystemId, entity, value);
    if (!registry.has(type, 'onInsert')) continue;
    registry.dispatch(type, 'onInsert', { world: app.world, commands: cmdHandle, entity, value } as HookCtx<unknown>);
  }
};

/**
 * Remove one component and fan out the `onRemove` hook. The hook fires
 * pre-mutation with the about-to-be-removed value, so a hook body that
 * does `world.getComponent(entity, T)` still sees the value.
 *
 * @internal
 */
const applyRemoveWithHooks = (
  app: App,
  entity: Entity,
  type: ComponentType,
  triggeringSystemId: SystemId,
): void => {
  if (!app.world.has(entity, type)) return;
  const value = app.world.getComponent(entity, type);
  if (value !== undefined) {
    dispatchLifecycleObservers(app, 'onRemove', type, triggeringSystemId, entity, value);
    const registry = app.componentHookRegistry;
    if (registry.has(type, 'onRemove')) {
      const cmdHandle = cmdHandleFor(app, triggeringSystemId);
      registry.dispatch(type, 'onRemove', { world: app.world, commands: cmdHandle, entity, value } as HookCtx<unknown>);
    }
  }
  app.world.removeComponent(entity, type);
};

/**
 * Despawn an entity, fanning `onRemove` out over every component the entity
 * carries (one hook invocation per component, in archetype type order),
 * then clear any entity-targeted observers bound to the entity before the
 * structural mutation lands.
 *
 * @internal
 */
const applyDespawnWithHooks = (
  app: App,
  entity: Entity,
  triggeringSystemId: SystemId,
): void => {
  if (!app.world.hasEntity(entity)) return;
  const cmdHandle = cmdHandleFor(app, triggeringSystemId);
  const registry = app.componentHookRegistry;
  const types = [...app.world.componentTypesOf(entity)];
  for (const type of types) {
    const value = app.world.getComponent(entity, type);
    if (value === undefined) continue;
    dispatchLifecycleObservers(app, 'onRemove', type, triggeringSystemId, entity, value);
    if (!registry.has(type, 'onRemove')) continue;
    registry.dispatch(type, 'onRemove', { world: app.world, commands: cmdHandle, entity, value } as HookCtx<unknown>);
  }
  app.observerRegistry.clearTargetedFor(entity);
  app.world.despawn(entity);
};

/**
 * Apply one queued command to the world / resources. Routes through the same
 * public `World` / `App` methods user code calls directly — so resource
 * change-frame stamps, archetype transitions, and tick columns behave the
 * same as direct mutations. Lifecycle hooks (`onAdd` / `onInsert` /
 * `onReplace` / `onRemove`) dispatch around each structural mutation; trigger
 * ops fan out to the observer registry. Carve-outs documented per-arm.
 *
 * The triggering system's id threads in so hook + observer bodies receive a
 * {@link CommandsHandle} bound to the same buffer that's currently being
 * drained; re-entrant ops fire later in the same flush, subject to the
 * re-entrant trigger depth limit ({@link MAX_TRIGGER_DEPTH}).
 *
 * @internal
 */
export const applyCommandOp = (op: CommandOp, app: App, triggeringSystemId: SystemId): void => {
  switch (op.kind) {
    case 'spawn': {
      applySpawnWithHooks(app, op.entity, op.components, triggeringSystemId);
      return;
    }
    case 'despawn': {
      applyDespawnWithHooks(app, op.entity, triggeringSystemId);
      return;
    }
    case 'insert': {
      if (!app.world.hasEntity(op.entity)) {
        app.logger.devWarn(
          `Commands.insert: entity ${op.entity} no longer exists at flush — skipping insert of ${op.components.length} component(s)`,
        );
        return;
      }
      applyInsertWithHooks(app, op.entity, op.components, triggeringSystemId);
      return;
    }
    case 'remove': {
      applyRemoveWithHooks(app, op.entity, op.type, triggeringSystemId);
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
        applyInsertWithHooks(app, op.child, [new Parent(op.parent)], triggeringSystemId);
      }
      // Append child to parent.Children (creating the component if absent).
      const children = app.world.getComponent(op.parent, Children);
      if (children) {
        if (!children.entities.includes(op.child)) {
          children.entities.push(op.child);
        }
      } else {
        applyInsertWithHooks(app, op.parent, [new Children([op.child])], triggeringSystemId);
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
        applyRemoveWithHooks(app, op.child, Parent, triggeringSystemId);
      }
      return;
    }
    case 'triggerGlobal': {
      // Depth was validated at enqueue (see `CommandsHandleImpl.trigger`); the
      // arm trusts the value. Reading the triggering system's current stage
      // for ResolveCtx via App state.
      dispatchGlobalTrigger(app, op.event, triggeringSystemId, app.currentFlushStage, op.depth);
      return;
    }
    case 'triggerEntity': {
      dispatchTargetedTrigger(
        app,
        op.event,
        op.target,
        triggeringSystemId,
        app.currentFlushStage,
        op.depth,
      );
      return;
    }
    case 'attachObserver': {
      if (!app.world.hasEntity(op.target)) {
        app.logger.devWarn(
          `commands.entity(${op.target}).observe: entity is not live at flush — observer not attached`,
        );
        return;
      }
      app.observerRegistry.registerTargeted(op.target, op.eventCtor, op.params, op.fn);
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
 *
 * Reactive methods (`trigger`, `observe`) post events targeted at this
 * entity and attach entity-scoped observers, respectively. Both fire at
 * flush, in enqueue order with the rest of the builder's calls.
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
  /**
   * Enqueue despawn of this entity. Cascades through `Children` (every
   * descendant is despawned) and removes this entity from its parent's
   * `Children` list. Dead descendants are skipped silently.
   */
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
   * Alias for {@link despawn}. Both cascade through `Children` and detach
   * this entity from its parent's `Children` list. Kept for call-site
   * intent — write `.despawnRecursive()` when reading the code should
   * emphasise the subtree walk; write `.despawn()` otherwise.
   */
  despawnRecursive(): void;
  /**
   * Enqueue an entity-targeted trigger of `event`. Fires every observer
   * bound to this `(entity, event class)` pair first, then every global
   * observer for the event class, in registration order — all during the
   * current commands flush, after the enqueueing system body returns.
   */
  trigger<E extends object>(event: E): EntityCommands;
  /**
   * Register an entity-targeted observer at flush time. The observer fires
   * synchronously inside `applyCommandOp` whenever an event of class
   * `eventCtor` is triggered against this entity. Mirrors the system
   * registration shape: a tuple of param tokens (conventionally led by
   * `Trigger(eventCtor)`) and a function receiving one value per param.
   *
   * The observer is dropped automatically when the entity is despawned.
   */
  observe<E extends object, const Ps extends readonly Param<unknown>[]>(
    eventCtor: ComponentType<E>,
    params: Ps,
    fn: (...args: ObserverArgs<Ps>) => void,
  ): EntityCommands;
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
 *
 * Reactive method `trigger` posts a global event whose observers fire during
 * the flush, in registration order. Re-entrant triggers (an observer body
 * calling `commands.trigger(...)` again) chain in the same flush, capped by
 * a re-entrant depth limit; a `devWarn` fires and the op is dropped at the
 * limit.
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
  /**
   * Enqueue a global trigger of `event`. Every global observer registered
   * against the event's class fires synchronously during the flush, in
   * registration order. To target a specific entity, use
   * `commands.entity(target).trigger(event)` instead.
   *
   * Re-entrant triggers (from inside an observer body) chain in the same
   * flush. The chain depth is capped at 8; the 9th nested trigger emits a
   * `devWarn` and is dropped.
   */
  trigger<E extends object>(event: E): void;
}

/**
 * Map a tuple of {@link Param}s to the tuple of values an observer body
 * receives. Same shape as `ParamValues` from system-param.ts; declared
 * locally so the observer surface in this file does not pull a value
 * dependency from system-param.
 */
type ObserverArgs<Ps extends readonly Param<unknown>[]> = {
  -readonly [K in keyof Ps]: Ps[K] extends Param<infer T> ? T : never;
};

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
    this.handle.enqueue({ kind: 'despawn', entity: this.id });
  }

  trigger<E extends object>(event: E): EntityCommands {
    const newDepth = this.handle.app.currentTriggerDepth + 1;
    if (newDepth > MAX_TRIGGER_DEPTH) {
      this.handle.app.logger.devWarn(
        `commands.entity(${this.id}).trigger: re-entrant trigger depth limit (${MAX_TRIGGER_DEPTH}) exceeded for event ${(event as object).constructor.name || '<anonymous>'} — dropping`,
      );
      return this;
    }
    this.handle.enqueue({
      kind: 'triggerEntity',
      event: event as object,
      target: this.id,
      depth: newDepth,
    });
    return this;
  }

  observe<E extends object, const Ps extends readonly Param<unknown>[]>(
    eventCtor: ComponentType<E>,
    params: Ps,
    fn: (...args: ObserverArgs<Ps>) => void,
  ): EntityCommands {
    this.handle.enqueue({
      kind: 'attachObserver',
      target: this.id,
      eventCtor: eventCtor as ComponentType,
      params: params as ReadonlyArray<Param<unknown>>,
      fn: fn as (...args: unknown[]) => void,
    });
    return this;
  }
}

class CommandsHandleImpl implements CommandsHandle {
  constructor(
    readonly app: App,
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

  trigger<E extends object>(event: E): void {
    const newDepth = this.app.currentTriggerDepth + 1;
    if (newDepth > MAX_TRIGGER_DEPTH) {
      this.app.logger.devWarn(
        `commands.trigger: re-entrant trigger depth limit (${MAX_TRIGGER_DEPTH}) exceeded for event ${(event as object).constructor.name || '<anonymous>'} — dropping`,
      );
      return;
    }
    this.enqueue({ kind: 'triggerGlobal', event: event as object, depth: newDepth });
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
