# Real Archetype ECS Storage

- **Created:** 2026-05-21
- **Status:** Planning

## Goal

`packages/ecs` ships a production-shaped archetype storage and query planner. A 10k-entity benchmark with three components iterates within 4× of a hand-written `for` loop over typed arrays. Public API (`World`, `spawn`, `despawn`, `addComponent`, `removeComponent`, `query`) remains stable from day-1 stub through this implementation.

## Phases

1. **Archetype graph** — data structure linking each `(componentSet → Archetype)` and entity → archetype membership; supports O(1) lookup.
2. **Column storage** — components stored as typed arrays (or homogenous arrays) per archetype, indexed by row. Define a `Component` registration API so types map to columns.
3. **Query planner** — compile a query (e.g. `Query<[Position, Velocity]>`) into a list of matching archetypes; iterate columns directly.
4. **Structural-change commands** — deferred command buffer so systems don't fragment archetypes mid-iteration. Mirrors Bevy's `Commands`.
5. **Benchmarks** — harness with golden numbers committed; CI runs benchmarks weekly (separate workflow, not blocking).
6. **Editor-time considerations** — assess whether editor needs a sparse-set sidecar for high-churn metadata; if yes, new ADR.

## Open questions

- Component registration: decorator-based (requires TC39 decorators), class-static, or symbol-keyed? Trade-off between ergonomics and TS strictness.
- Resource singletons (Bevy's `Res<T>`): same `World` or separate? Probably same — needs an ADR.
- Component change detection (Bevy's `Changed<T>`): add now or after first benchmark? Probably later.
- Worker-thread parallelism: out of scope until benchmarks justify it.

## Links

- ADR-0005 — chose archetype storage
- Bevy ECS internals: https://bevy-cheatbook.github.io/programming/ecs-intro.html
- Flecs manual: https://www.flecs.dev/flecs/md_docs_2Manual.html
