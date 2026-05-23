---
'@retro-engine/ecs': minor
'@retro-engine/engine': minor
---

feat(ecs,engine): observers + Message<T> + component lifecycle hooks (M3 phase 2)

Push-based half of the ECS reactivity layer, on top of the change-detection primitive shipped in ADR-0012. Sealed in ADR-0013. Adopts Bevy 0.17 vocabulary (`Message` / `Event` split, `.write` writer name) on day 1 so consumers do not face a later rename.

**ECS (`@retro-engine/ecs`):**

- `World.advanceTick(): number` — public additive method bumping the mutation counter without touching any tick column or removed buffer. Used by `MessageWriter.write` to stamp messages with a strictly-increasing tick, eliminating the missed-message edge case when a system writes messages but does no structural mutations.
- `World.componentTypesOf(entity)` (`@internal`) — enumerate the component classes currently attached to an entity. Used by the engine commands flush for the per-component `onRemove` fan-out at despawn.

**Engine (`@retro-engine/engine`):**

- **Message channels.** `MessageWriter(ctor)` / `MessageReader(ctor)` system params. `app.addMessage(ctor)` registers a type. Writers stamp each `.write(msg)` with a fresh world tick; readers filter by `lastSeenTick`, mirroring `RemovedComponents`. Per-type buffers drain at end of `advanceFrame`, after `world.drainRemovedBuffer()`.
- **Observers + triggers.** `commands.trigger(event)` enqueues a global trigger; `commands.entity(e).trigger(event)` enqueues an entity-targeted one. `app.addObserver(eventCtor, params, fn)` registers a global observer; `commands.entity(e).observe(eventCtor, params, fn)` registers an entity-targeted one (deterministically at flush). `Trigger(eventCtor)` param exposes `trigger.event()` and `trigger.entity()`. Targeted observers fire before globals; observers run in registration order. Triggers fire at the commands flush, not at the call site.
- **Re-entrant triggers.** An observer body that calls `commands.trigger(...)` chains into the same flush. Depth limit 8; the 9th nested trigger emits a `devWarn` and is dropped.
- **Component lifecycle hooks.** `onAdd` / `onInsert` / `onReplace` / `onRemove`, declared as static methods on the component class (`class Sprite { static onAdd(ctx) {…} }`) or registered via `app.registerComponentHook(ctor, kind, fn)`. Hooks fire during the commands flush — pre-mutation for `onReplace` / `onRemove`, post-mutation for `onAdd` / `onInsert`. Static methods fire before registry entries; registry entries fire in registration order. Hook ctx exposes `world`, `commands` (bound to the triggering system's buffer), `entity`, and `value`.
- **Despawn cleans up entity-targeted observers.** No leak across entity reuse.
- **`flushSystemCommands` reworked** to process the buffer with a while-loop pattern so ops enqueued by hooks / observers during dispatch fire in the same flush. Try-finally cleanup ensures throw-safety: the buffer entry is removed even when an applyCommandOp arm throws mid-flush.

**Out of scope (deferred):**

- Lifecycle-as-trigger sugar (Bevy's `Event<OnAdd<T>>` / `Event<OnRemove<T>>`). The ordering rule "observers before hooks" is locked in ADR-0013 so a follow-up slice can land the sugar without re-opening this ADR.
- Migrating recursive despawn (`commands.entity(e).despawnRecursive`) from its manual `Children` walk to an `onRemove(Parent)` hook. Surface shipped here; migration is the natural first consumer in the follow-up slice.
- A constrained `DeferredWorld` wrapper class. v1 hooks receive the full `World` reference + a `CommandsHandle`; recoverable when a footgun manifests in practice.
- Direct `world.spawn` / `world.insertBundle` / `world.removeComponent` / `world.despawn` calls (outside a commands flush) do NOT fire hooks or observers in v1. Test code that needs hook coverage routes through `Commands`.
