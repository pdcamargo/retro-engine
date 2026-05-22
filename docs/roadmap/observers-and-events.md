# Observers and Events

- **Created:** 2026-05-21
- **Status:** Future direction (sketch — designed alongside M2, impl deferred)

## Goal

A reactive layer on top of the ECS: **component hooks** that fire on lifecycle (component added, replaced, removed) and **observers** that listen for triggered events on entities (or globally). Together, they let plugins respond to world changes without polling — when a `Health` reaches 0, fire a `Death` event; when a `Sprite` is added, register it with the render extractor; when a parent despawns, the hook cleans up its children.

This roadmap also locks the vocabulary split Bevy adopted in 0.17 — and that we adopt from day 1, so we don't burn a name and rename later:

- **`Message<T>`** — frame-buffered, fire-and-forget. Writers post; readers iterate at their convenience within a frame (or the next). Replaces what Bevy used to call `Event`.
- **`Event<T>`** — observed/triggered. A trigger fires; registered observers run synchronously. Used with `Trigger<E>` as a system param. The narrow, reactive case.

We're done when: a component hook fires on lifecycle, an observer fires on trigger, observer ordering is deterministic (observers before hooks, matching Bevy 0.16+), and both compose with the `Commands` deterministic-flush guarantee from M2.

## Phases

1. **`Message<T>` channels** — `MessageWriter<T>` / `MessageReader<T>` system params, double-buffered storage (current frame + previous), automatic clear on the next frame swap. Frame-bound semantics; no persistence.
2. **`Event<T>` triggers + observers** — `commands.trigger(event)` posts a global trigger; `commands.entity(e).trigger(event)` posts a targeted one. Observers register via `app.addObserver([Trigger<E>], (trig) => ...)` for global or `commands.entity(e).observe([Trigger<E>], ...)` for entity-scoped. Synchronous: trigger fires, observers run in registration order.
3. **Component hooks** — `onAdd` / `onInsert` / `onReplace` / `onRemove`. Declared on the component class (static methods or registered separately). Fire as part of the deterministic Commands flush from M2. Observers run before hooks (Bevy 0.16+ ordering).
4. **`Trigger<E>` as a system param** — observer functions are systems too. They declare standard params plus `Trigger<E>` to access the event payload + target entity (for targeted triggers).
5. **`DeferredWorld` analog for hooks** — hooks need to mutate, but mid-flush. Bevy passes a `DeferredWorld` (limited mutation access); we adopt a similar shape — hooks see a constrained `World` view that queues further mutations into the same flush.
6. **Observer ergonomics** — `onAdd<Component>` / `onRemove<Component>` are common enough to be sugar over component hooks. Provide both: hooks for the underlying mechanism, sugar for the 80% case.
7. **Performance characteristics** — observers / hooks are O(registered) per trigger. Cheap when sparse, expensive when many. Document the cost model so consumers don't trigger high-frequency events.

## Open questions

- **Hook declaration mechanism.** Class-static methods (`class Sprite { static onAdd(world, entity) { ... } }`) read clean but make the hook discoverable only via reflection. Plugin-side registration (`app.registerHook(Sprite, 'onAdd', fn)`) is more flexible but less colocated. Default lean: support both — built-in lifecycle declared on the class, plugin-side registration for cross-cutting hooks.
- **Trigger payload shape.** Bevy passes `Trigger<E>` carrying the event + target entity. We do the same; the targeted-vs-broadcast distinction is whether `trigger.entity()` returns `Some(Entity)` or `None`.
- **Re-entrant triggers.** If observer A's run triggers event B, do B's observers run immediately or queue until A's stage finishes? Bevy queues. We probably queue. Lock at execution.
- **Hook timing relative to Commands flush.** All hooks/observers fire *during* the flush (not after the flush completes), so multiple mutations within a single flush all see consistent intermediate state. This is the Bevy 0.16+ guarantee; we adopt it.
- **`Message<T>` lifecycle when a reader is gated by `runIf`.** A reader inside `runIf(inState(Playing))` doesn't run while paused. Do messages accumulate? Bevy: yes, with an explicit hazard noted (readers can miss messages if frames pass between writes and reads). We document the same hazard.
- **Should observers be observers of observers?** I.e., can an observer trigger another event whose observer runs in the same flush? Yes, recursively, with cycle detection at execution time. Bound recursion depth.

## Links

- Foundation: `docs/roadmap/engine-foundations.md` (M2 Commands deterministic-flush guarantee is the precondition for predictable observer/hook ordering)
- Adjacent: `docs/roadmap/change-detection.md` — overlapping reactive surface; observers are push-based, change detection is pull-based. Both coexist.
- Consumer: `docs/roadmap/scenes-and-prefabs.md` — scenes bind observers inline.
- Consumer: `docs/roadmap/system-params.md` — `Trigger<E>` joins the catalog of system params.
- Consumer: `docs/roadmap/transform-and-hierarchy.md` — recursive despawn-on-remove-parent is naturally an `onRemove` hook on `Parent`.
- ADR-0001 (composition — observers are functions registered against types, not subclasses of an `EventListener` base)
- External:
  - Bevy observer/hook ordering overhaul ([HackMD: Observer Overhaul](https://hackmd.io/@bevy/rk4S92hmlg))
  - Bevy component lifecycle hooks ([PR #19543](https://github.com/bevyengine/bevy/pull/19543))
  - Bevy 0.17 Event → Message rename ([0.16→0.17 migration](https://bevy.org/learn/migration-guides/0-16-to-0-17/))
