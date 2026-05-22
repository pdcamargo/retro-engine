# ECS Archetype World

- **Created:** 2026-05-21

## Context

The current `World` (`packages/ecs/src/index.ts`, 49 lines) is a `Map<Entity, Map<ComponentType, unknown>>` with no multi-component query — `entities()` yields every live entity and callers must `getComponent` per type per entity to filter. This is fine as a contract anchor but cannot host real gameplay: every query is O(entities × types), archetype-aware iteration is impossible, and the public surface offers no place for component-level invariants (Required Components, Disabled marker, etc.).

This backlog item replaces the stub with **real archetype-based storage**, per ADR-0005. The work bundles three tightly coupled concerns:

1. **Archetype graph + column storage** — each unique component set is an `Archetype`; data lives as side-by-side typed arrays (or homogenous arrays) per archetype, indexed by row. Adding or removing a component moves the entity's row between archetypes.
2. **Required Components** — a component declares its dependencies (e.g., `Sprite.requires = [Transform, GlobalTransform, Visibility]`); spawning a `Sprite` auto-inserts the required components if absent, using each one's `Default`-equivalent. Bundle-as-tuple spawning (`world.spawn([A, B, C])`) remains as a secondary convenience.
3. **Entity Disabling** — a `Disabled` marker component. Queries skip entities carrying `Disabled` by default; `With<Disabled>` opts back in. Cheap pause / pooling / show-hide.

```ts
// Approximate surface.
class Position { constructor(public x = 0, public y = 0) {} }
class Velocity { constructor(public vx = 0, public vy = 0) {} static requires = [Position]; }

const e = world.spawn(new Velocity(1, 0)); // Position auto-inserted via Required

for (const [pos, vel] of world.query([Position, Velocity])) {
  pos.x += vel.vx;
}

world.entity(e).insert(new Disabled());        // hidden from default queries
for (const [pos] of world.query([Position])) { /* skips disabled */ }
for (const [pos] of world.query([Position], { with: [Disabled] })) { /* includes */ }
```

Filters: `With<T>`, `Without<T>`, `Has<T>` (returns boolean per row). Multi-archetype iteration must respect insertion order within an archetype but ordering across archetypes is unspecified. `Changed<T>` / `Added<T>` are out of scope here — designed in `docs/roadmap/change-detection.md`, implemented later.

Performance target is loose for M2: a 1000-entity multi-archetype query must complete within a frame budget without obvious quadratic behavior. Real benchmarks against the 10k / 4× targets in ADR-0005 land in the post-M2 `ecs-storage.md` work.

## Why deferred

M2 phase 4. Depends on the system param protocol (phase 1) so `Query([A, B])` is a real param. Standalone from the resource registry / Time / Commands lines of work — can be developed independently of phase 2 and 3, but lands before phase 6 (Commands consume the World) and phase 7 (Transform hierarchy is the first real Required + Query consumer).

## Acceptance

- `packages/ecs` exposes a new `World` implementation backed by archetype graph + column storage. The public surface (`spawn`, `despawn`, `addComponent`, `removeComponent`, `getComponent`, `has`) is preserved or replaced with documented migrations.
- `world.query([A, B])` returns an iterator yielding tuples of component instances, iterating only matching archetypes.
- Component classes/symbols can declare a static `requires: ComponentType[]`; spawning auto-inserts missing required components.
- `Disabled` marker component exists; queries exclude disabled entities by default; opt-in filter restores them.
- Filter shapes: `With<T>`, `Without<T>`, `Has<T>`.
- Tests cover: archetype transition on add/remove; multi-component query iterates only matching archetypes; Required Components auto-insert chains (A requires B requires C); Disabled excludes by default and is restorable.
- Single-threaded throughout; no shared-memory primitives, no worker offload.
- The existing 49-line stub at `packages/ecs/src/index.ts` is replaced or deprecated cleanly; if deprecated, the deprecation path is captured in a migration note.

## Links

- Roadmap: `docs/roadmap/engine-foundations.md` (M2 umbrella, phase 4)
- ADR-0005 (chose archetype storage; this backlog item is its execution)
- Prereq: `docs/backlog/system-param-protocol.md`
- Consumers: `docs/backlog/engine-commands-buffer.md`, `docs/backlog/transform-hierarchy.md` (first real Required + query consumer)
- Future direction: `docs/roadmap/ecs-storage.md` (perf, sparse-set sidecar, archetype-graph fragmentation) and `docs/roadmap/change-detection.md` (`Changed<T>` / `Added<T>`)
- External: Bevy archetype iteration ([bevy-cheatbook](https://bevy-cheatbook.github.io/programming/ecs-intro.html)); Bevy Required Components ([0.15 release notes](https://bevy.org/news/bevy-0-15/)); Bevy entity disabling ([example](https://bevy.org/examples/ecs-entity-component-system/entity-disabling/))
