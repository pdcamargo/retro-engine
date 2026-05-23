---
'@retro-engine/ecs': minor
'@retro-engine/engine': minor
---

feat(ecs,engine): ECS change detection — Changed<T> / Added<T> / RemovedComponents<T>

Surface the per-component mutation ticks already wired into archetype storage so systems can observe what changed since they last ran. First slice of M3 ECS reactivity; sealed in ADR-0012.

**ECS (`@retro-engine/ecs`):**

- `World.changeTick` — public read-only getter exposing the monotonic mutation counter. Advances on every `spawn`, `insertBundle`, `removeComponent`, `despawn`, and `markChanged`.
- `World.markChanged(entity, type)` — explicit mark-dirty for in-place mutation of reference-typed component data. Bumps the tick and writes the new value into the component's `changedTick` column. Silent no-op on unknown entity or absent component.
- `QueryFilters` gains `changed?: ComponentType[]` and `added?: ComponentType[]`. Both gate row inclusion against a per-system `sinceTick` threshold; neither alters row shape (unlike `has`).
- `World.query(types, filters, sinceTick?)` — new optional third arg threads through to the filter check. Defaults to `0` ("observe everything") so existing callers behave identically.
- Storage carries two parallel tick columns per component — `changedTickColumns` (mutation) and `addedTickColumns` (attach). `Added<T>` implies `Changed<T>` by construction.
- Per-component removal buffer on `World` populated by `removeComponent` and `despawn`. Read via internal `getRemovedComponents(type)`; drained at frame boundary by `drainRemovedBuffer()`.
- `RemovedEntry` type re-exported from the package root.

**Engine (`@retro-engine/engine`):**

- `RemovedComponents(ctor)` — new system param yielding `Iterable<Entity>` over entities whose component was removed since the calling system's last run. Frame-boundary drain (v1 limitation: `runIf`-gated systems lose removals from frames they did not run in).
- `ResolveCtx` gains a required `lastSeenTick: number`. The scheduler captures `World.changeTick` pre-system (Bevy-aligned pre-run snapshot) and writes it to a per-system `lastSeenTickMap` on `App` after the system runs. Consequence: a system re-observes its own prior-frame mutations on its next invocation.
- `Query(types, filters)` param threads `ctx.lastSeenTick` through to `World.query` automatically. Filter cache key extended to include `changed` / `added` content.
- All system-running paths (`runStage` for Main/FixedMain, `invokeStateSystem` for state transitions, `App.renderFrame` for render) participate in the same snapshot model.
- `App.advanceFrame` drains the removed-components buffer at end of frame, after every stage.

**Out of scope (deferred):**

- Finer-grained resource change detection. `App.resourceChangeFrames` and the `resourceChanged` run-condition are unchanged; no `Res<T>.isChanged()` / `ChangedRes(T)`. Promotes from backlog when a real consumer pulls.
- Gating `propagateTransforms` on `Changed<Transform>`. The surface is shipped here; the optimization gets its own slice.
