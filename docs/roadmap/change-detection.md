# Change Detection

- **Created:** 2026-05-21
- **Status:** Future direction (sketch — designed alongside M2, impl deferred)

## Goal

Query filters that surface only entities whose component was added or mutated since the last time a system observed it. The Bevy equivalent: `Added<T>` (component was just added to this entity), `Changed<T>` (component was added *or* mutated). Implemented via per-component generation counters — every mutation bumps the counter, queries track the last-observed counter per system.

The point isn't novelty; it's reducing wasted work. A system that updates `GlobalTransform` from `Transform` doesn't need to scan every entity every frame — only the ones whose `Transform` actually changed. A render extractor only needs to re-upload sprites whose `Sprite` or `Transform` changed.

This file documents the design. **Implementation is not in M2** but the M2 archetype storage (`docs/backlog/ecs-archetype-world.md`) bakes in a generation-counter column from day 1 so the impl can land later without re-storaging.

## Phases

1. **Generation counters** — each component column carries a side-by-side `lastChangeTick: number[]` column. Every mutation through the World/Commands surface bumps the global tick and writes the new tick into the column. This piece *is* part of M2's archetype storage; the rest of the work below builds on it.
2. **`Changed<T>` query filter** — `world.query([A], { changed: [A] })` yields rows where A's `lastChangeTick > systemLastSeenTick`. Each system tracks its own last-seen tick.
3. **`Added<T>` query filter** — `world.query([A], { added: [A] })` yields rows where A was added since the system's last run. Distinct from `Changed` — a long-lived component that mutates is `Changed` but not `Added`.
4. **Resource change detection** — `Res<T>.isChanged()` returns true when the resource was mutated since this system last read it. `resource_changed::<T>()` run condition shorthand from `docs/backlog/engine-schedule-and-states.md` uses this under the hood.
5. **Per-field change detection** — when reflection is available, "did *this field* change?" becomes queryable. Niche; relevant for editor live-update and reactive UI. Tied to `docs/roadmap/reflection-and-serialization.md`.
6. **Tick wrapping** — `number` is fine in JS (Number.MAX_SAFE_INTEGER won't overflow in any realistic game session). A `BigInt` upgrade is overkill. Document the assumption.

## Open questions

- **Mutation-detection mechanism.** Mutating a component is a JS object write — we can't proxy it for free without runtime overhead. Two options:
  - **Mutate-through-API only**: writes go through `world.entity(e).get(T)` which returns a wrapped accessor that bumps the tick. Clean, but verbose.
  - **Explicit mark-dirty**: after mutating, the user calls `world.markChanged(e, T)`. Cheap, but easy to forget.
  - **Proxy-wrapped components**: `getComponent` returns a Proxy that intercepts writes. Convenient, but Proxy has measurable runtime cost.
  - Default lean: explicit mark-dirty for v1 (cheap, predictable), with a wrapped-accessor sugar layer if it becomes painful. Lock at execution.
- **`Changed` semantics on add.** Bevy says yes — an `Added` is also `Changed`. We follow.
- **Cross-frame `Changed` for systems with `runIf`.** A system that didn't run last frame (gated by `runIf`) — does it see this-frame changes only, or accumulated changes since its last run? Bevy: accumulated. We follow.
- **Removed components.** Bevy has `RemovedComponents<T>`. Worth shipping as part of this milestone? Probably yes; lifecycle is symmetric (Add / Change / Remove).
- **Cost on heavily-mutated columns.** Bumping a tick per mutation is cheap; iterating a `Changed<T>` filter still scans the column for ticks newer than the threshold. For sparse changes, that's wasteful. Bevy uses archetype-level dirty bits as an optimization. Document as a future perf concern.

## Links

- Foundation: `docs/roadmap/engine-foundations.md` (M2 archetype storage includes per-column generation counters even before the change-detection impl)
- Sibling: `docs/roadmap/observers-and-events.md` — overlapping reactive surface; observers are push-based, change detection is pull-based.
- Consumer: `docs/roadmap/transform-and-hierarchy.md` — propagation only needs to recompute `GlobalTransform` where `Changed<Transform>` is true.
- Consumer: `docs/roadmap/reflection-and-serialization.md` — per-field change detection requires reflection metadata.
- Consumer: `docs/roadmap/ui-system.md` — reactive UI updates on resource/component changes.
- ADR-0005 (archetype storage — the column layout is what makes generation counters cheap)
- External:
  - Bevy `Changed<T>` / `Added<T>` ([bevy-cheatbook: query-filter](https://bevy-cheatbook.github.io/programming/queries-filter.html))
  - Bevy change detection internals ([docs.rs/bevy_ecs/change_detection](https://docs.rs/bevy_ecs/latest/bevy_ecs/change_detection/index.html))
