import type { ComponentType, Entity, World } from '@retro-engine/ecs';

import type { CommandsHandle } from './commands';

/**
 * Context handed to a component lifecycle hook. The shape is forward-stable:
 * adding fields (e.g. a `DeferredWorld` wrapper) is additive on the readonly
 * facade and does not break callers.
 *
 * - `world` is the live world. Direct mutations are allowed but discouraged;
 *   prefer enqueuing via `commands` so re-entrant ops respect the
 *   deterministic per-system Commands flush ordering.
 * - `commands` is bound to the triggering system's command buffer, so any
 *   mutation a hook enqueues fires later in the same flush.
 * - `entity` is the row the hook is firing for.
 * - `value` is the component value at the hook's logical moment:
 *    - `onAdd` / `onInsert` — the just-installed value (storage already
 *      reflects the write).
 *    - `onReplace` — the **old** value, before the new one overwrites it.
 *    - `onRemove` — the about-to-be-removed value, before storage clears it
 *      (so `world.getComponent(entity, T)` still returns it inside the
 *      hook body).
 */
export interface HookCtx<T> {
  readonly world: World;
  readonly commands: CommandsHandle;
  readonly entity: Entity;
  readonly value: T;
}

/** The four component lifecycle moments a hook can attach to. */
export type HookKind = 'onAdd' | 'onInsert' | 'onReplace' | 'onRemove';

type HookFn<T = unknown> = (ctx: HookCtx<T>) => void;

interface PerTypeHooks {
  readonly onAdd: HookFn[];
  readonly onInsert: HookFn[];
  readonly onReplace: HookFn[];
  readonly onRemove: HookFn[];
}

/**
 * Per-app registry of plugin-side component hooks. The class-static side —
 * `class Sprite { static onAdd(ctx) {…} }` — is discovered reflectively at
 * dispatch time and fires first; registry entries fire next, in registration
 * order.
 *
 * Single resolution path: callers do not see the static-vs-registry split.
 *
 * @internal Engine-private; consumers go through
 * `App.registerComponentHook`.
 */
export class ComponentHookRegistry {
  private readonly hooks = new Map<ComponentType, PerTypeHooks>();

  /** Append `fn` to the `kind`-list for `ctor` (registration order). */
  register(ctor: ComponentType, kind: HookKind, fn: HookFn): void {
    let perType = this.hooks.get(ctor);
    if (!perType) {
      perType = { onAdd: [], onInsert: [], onReplace: [], onRemove: [] };
      this.hooks.set(ctor, perType);
    }
    perType[kind].push(fn);
  }

  /**
   * Whether any hook of any kind is reachable for `ctor` — either via the
   * registry or via a static method on the constructor. Used by the
   * dispatcher to fast-path the no-hooks case.
   */
  hasAny(ctor: ComponentType): boolean {
    if (this.hooks.has(ctor)) return true;
    const c = ctor as Partial<Record<HookKind, HookFn>>;
    return (
      typeof c.onAdd === 'function' ||
      typeof c.onInsert === 'function' ||
      typeof c.onReplace === 'function' ||
      typeof c.onRemove === 'function'
    );
  }

  /**
   * Whether a hook of `kind` exists for `ctor`. Cheaper than `hasAny` when
   * only one kind is being dispatched.
   */
  has(ctor: ComponentType, kind: HookKind): boolean {
    const perType = this.hooks.get(ctor);
    if (perType && perType[kind].length > 0) return true;
    const staticFn = (ctor as Partial<Record<HookKind, HookFn>>)[kind];
    return typeof staticFn === 'function';
  }

  /**
   * Fire `kind` for `ctor` with `ctx`. Order: the constructor's static
   * method (if defined) first, then registry entries in registration order.
   * Throws if the constructor's static hook or a registry entry throws;
   * the throw propagates to the commands flush, which is responsible for
   * cleanup.
   */
  dispatch(ctor: ComponentType, kind: HookKind, ctx: HookCtx<unknown>): void {
    const staticFn = (ctor as Partial<Record<HookKind, HookFn>>)[kind];
    if (typeof staticFn === 'function') {
      staticFn(ctx);
    }
    const perType = this.hooks.get(ctor);
    if (perType) {
      for (const fn of perType[kind]) fn(ctx);
    }
  }
}
