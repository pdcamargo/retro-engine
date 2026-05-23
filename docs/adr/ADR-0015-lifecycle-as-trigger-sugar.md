# ADR-0015: Lifecycle-as-Trigger Sugar

- **Status:** Accepted
- **Date:** 2026-05-23

## Context

ADR-0013 (M3 phase 2) shipped two parallel reactive surfaces: per-component lifecycle **hooks** (`onAdd` / `onInsert` / `onReplace` / `onRemove`, dispatched inline inside the four `apply*WithHooks` helpers in `commands.ts`) and global / entity-targeted **observers** for arbitrary user event classes posted via `commands.trigger(event)`.

§11 of ADR-0013 pre-locked the ordering rule "observers fire before hooks for the same lifecycle moment" but deferred the actual wiring to a follow-up slice — to keep that ADR's surface focused on the hook foundation and the recursive-despawn migration (ADR-0014, the first hook-only consumer). §16 named lifecycle-as-trigger sugar — Bevy's `Event<OnAdd<T>>` / `OnInsert<T>` / `OnReplace<T>` / `OnRemove<T>` — as the next natural consumer.

ADR-0014 landed in May 2026. Component hooks are stable in shipped code; observers fire only for `commands.trigger(...)` events. This ADR closes the §11 loop: component mutations become observable through the same `Trigger<E>` surface gameplay events already use, with observers running strictly before hooks for the same `(kind, type)`.

TypeScript type-erases generics, so the Bevy-style `OnAdd<Sprite>` event type cannot exist as a static type that the registry keys on. The ADR must therefore decide how to represent the per-`(kind, componentCtor)` event identity in a way the existing observer machinery — which keys on `ComponentType` — can consume unmodified.

## Decision

A four-method factory namespace `Lifecycle`, co-located with the hook surface in `component-hooks.ts`:

- `Lifecycle.onAdd(Sprite)` / `Lifecycle.onInsert(Sprite)` / `Lifecycle.onReplace(Sprite)` / `Lifecycle.onRemove(Sprite)`.

Each method returns a **synthetic class**, cached per `(kind, componentCtor)` pair so `Lifecycle.onAdd(Sprite) === Lifecycle.onAdd(Sprite)`. Mirrors the existing `Trigger(eventCtor)` caching in `observers.ts:25–72`. The returned class is a `ComponentType<LifecycleEvent<T>>` and is usable as the event-key argument for `app.addObserver`, `commands.entity(e).observe`, and `Trigger(...)` — zero special-casing in the registry or dispatcher.

Event payload shape `{ entity, value }`, mirroring `HookCtx<T>`. The `value` follows the same per-kind semantics ADR-0013 §13 / §15 locked in for hooks: just-installed for `onAdd` / `onInsert`, OLD value for `onReplace`, about-to-be-removed for `onRemove`. No `kind` field on the payload — the event class identity *is* the kind.

A single internal helper `dispatchLifecycleObservers(app, kind, type, triggeringSystemId, entity, value)` lives next to the factory. It resolves the synthetic class via the same cache, fast-paths out when no observer is registered, and otherwise routes through the existing `dispatchTargetedTrigger(...)`. Targeted-before-global ordering and registration-order ordering within each are inherited from that dispatcher — same Bevy semantics gameplay-event observers already obey.

Splice point: each of the four `apply*WithHooks` helpers in `commands.ts` calls `dispatchLifecycleObservers` immediately before its `componentHookRegistry.dispatch(...)` call(s). Seven splice sites total (two in `applySpawn`, three in `applyInsert`, one in `applyRemove`, one in `applyDespawn`'s per-component fan-out). The order — observer first, then hook — fulfils §11 with no edit to ADR-0013.

**Depth handling:** lifecycle dispatch is **inline**, not queued — it does not enqueue `triggerGlobal` / `triggerEntity` ops, and it passes `app.currentTriggerDepth` through unchanged to `dispatchTargetedTrigger`. A lifecycle observer that calls `commands.trigger(...)` enqueues a trigger op stamped at `currentDepth + 1`, so the `MAX_TRIGGER_DEPTH = 8` cap from ADR-0013 §10 continues to apply to the gameplay-event side. The cap is **not** extended to lifecycle dispatch itself — arbitrarily long observer→spawn→observer chains run without spurious devWarn. Matches the spirit of ADR-0014 §1, where the cascade chain is exempt from the cap by the same property.

**Carve-outs preserved:**

- `onAdd` / `onInsert` / `onReplace` fire only for user-passed component types (not required-component expansions), matching ADR-0013 §13's hook-side rule.
- `onRemove` fires per-component during the despawn fan-out — including framework types like `Children`, `Parent`, `GlobalTransform`. Lets consumers observe the cascade moment via `Lifecycle.onRemove(Children)`, which (under the §11 ordering rule) runs **before** `CorePlugin`'s cascade-driving hook tears the subtree down.

**Helper signature change.** The four `apply*WithHooks` helpers previously took a `CommandsHandle` parameter and never saw the `SystemId` behind it. They now take `triggeringSystemId: SystemId` directly and reconstruct the handle via the existing `cmdHandleFor(app, systemId)` — needed because `dispatchLifecycleObservers` requires `SystemId` to thread into `dispatchTargetedTrigger`'s `invokeObserver`. Mechanical change, no public-surface impact.

**Convenience surface — keep raw only.** `app.addObserver(Lifecycle.onRemove(Sprite), [Trigger(Lifecycle.onRemove(Sprite))], fn)` is verbose (the event class is mentioned twice), but it is the same one-path-through-the-registry shape `app.addObserver` has always had. A shortcut like `app.observe.onRemove(Sprite, ...)` is rejected for v1: doubling the public API to save one identifier is the wrong trade. Revisit if downstream call-site readability suffers.

## Consequences

**Easier:**

- A consumer can audit subtree death just before the cascade runs (`Lifecycle.onRemove(Children)` observer), log every `Sprite` insertion app-wide (`Lifecycle.onAdd(Sprite)` global), or scope a per-entity teardown callback (`cmd.entity(e).observe(Lifecycle.onRemove(MyComp), …)`) — all through the same Trigger / observer surface they already use for gameplay events. No new mental model.
- The §11 ordering rule has consequences for end users today, not just for the engine's own future. Lifecycle-as-trigger sugar is the first place §11 is observable from outside the engine.
- Composes cleanly with ADR-0014's cascade: the cascade hook is one consumer-replaceable component hook, the cascade *moment* is now observable via `Lifecycle.onRemove(Children)` without monkey-patching `CorePlugin`.

**Harder:**

- The verbose raw call site (decision (f)) is real ergonomic cost. Consumers will likely alias locally: `const SpriteAdded = Lifecycle.onAdd(Sprite);`. Acceptable for v1; revisit if widespread.
- Per-mutation hot path now does one extra synthetic-class fetch (`makeLifecycleCtor`, a `WeakMap.get`) and two `Map.get(...).length === 0` checks per component, even when no observer is registered. Microsecond cost at any realistic N.

**Accepted trade-offs:**

- The factory returns a TS `class` rather than a parametric event with `kind` / `componentCtor` fields. The class-identity approach (decision (a)(i)) means the existing observer registry's `Map<ComponentType, …>` works unmodified, at the cost of one synthetic class allocated per `(kind, componentCtor)` pair on first access. Caching makes the cost one-time.
- `MAX_TRIGGER_DEPTH` is **not** applied to lifecycle dispatch. Pathological observer→spawn→observer chains run unbounded by the cap; the user is responsible for terminating them (typically via a counter or a `hasEntity` guard, the same way ADR-0014's cascade self-terminates). If pathological chains surface in production, depth-limiting lifecycle dispatch is its own future ADR.
- Direct `world.spawn` / `world.insertBundle` / `world.removeComponent` / `world.despawn` calls (outside the commands flush) still do not fire lifecycle observers, consistent with ADR-0013 §13 for hooks. Test code that needs lifecycle-observer coverage routes through `Commands`.

## Rejected alternatives

- **Parametric event with `kind` / `componentCtor` fields keyed via a composite registry.** Would require special-casing the observer registry to switch from `Map<ComponentType, …>` to `Map<(kind, ctor), …>` for lifecycle events. Forks the dispatch path, doubles the dispatcher's complexity, and makes `Trigger(...)` for lifecycle events syntactically different from `Trigger(...)` for gameplay events. The synthetic-class approach is symmetric.
- **Generate the event class once per kind, not per (kind, ctor) pair.** Would mean all `onAdd` observers (regardless of component type) fire for every `onAdd`. Forces consumers to manually filter by `event.value instanceof Sprite` in every observer body — the opposite of the type-discrimination the registry already provides for free.
- **Add a convenience shortcut (`app.observeLifecycle('onRemove', Sprite, ...)` or `app.observe.onRemove(Sprite, ...)`).** Decision (f) — keep raw only for v1. The shortcut would be a second path through the registry, forking the docs and the mental model. The verbose form is one path consumers already know.
- **Extend `MAX_TRIGGER_DEPTH` to cover lifecycle dispatch.** Would mean ADR-0014's cascade chain hits the cap at depth 8 — a regression for deep hierarchies. Per-slice exemption (lifecycle dispatch transparent w.r.t. depth) preserves the cap where it matters (re-entrant `cmd.trigger` chains) without breaking cascade.
- **Wait for resource-mutation observers / `Changed<T>` resources to land first.** Lifecycle-as-trigger sugar is orthogonal to those slices (ADR-0012 §7 / §8); coupling them delays both without benefit.

## Implementation

- `packages/engine/src/component-hooks.ts` — adds `LifecycleEvent<T>` interface, `Lifecycle` namespace (four factories backed by a `WeakMap<ComponentType, Partial<Record<HookKind, EventCtor>>>` cache), and the `dispatchLifecycleObservers` helper.
- `packages/engine/src/commands.ts` — the four `apply*WithHooks` helpers now take `triggeringSystemId: SystemId` instead of a constructed `CommandsHandle`; each calls `dispatchLifecycleObservers(...)` immediately before its `componentHookRegistry.dispatch(...)` calls (seven splice sites total). Call sites in `applyCommandOp` and the `appendChild` / `detachChild` arms updated accordingly.
- `packages/engine/src/index.ts` — exports `Lifecycle` (value) and `LifecycleEvent` (type).
- `packages/engine/src/lifecycle.test.ts` — new file: identity, the four kinds (with value-snapshot assertions for `onReplace` OLD-value and `onRemove` storage-still-present), entity-targeted observers (including despawn-time fan-out and observer-clear), observer-before-hook ordering, the cascade-interaction case (observer for `Lifecycle.onRemove(Children)` sees the live subtree before `CorePlugin`'s cascade hook tears it down), and a long re-entrant chain that confirms lifecycle dispatch does not consume `MAX_TRIGGER_DEPTH` slots.
