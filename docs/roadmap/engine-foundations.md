# Engine Foundations (M2)

- **Created:** 2026-05-21
- **Status:** In progress

## Goal

After M1 (First Render Path), the renderer HAL is real but the engine and ECS underneath it are stubs: `World` is 49 lines of `Map<Entity, Map<Type, unknown>>` with no multi-component queries, `App` is a 181-line stage enum + frame loop with no resource registry, no time, no run conditions, no ordering within a stage, no commands buffer, no plugin lifecycle. Any subsequent visible-deliverable milestone (sprites, input, UI, scenes) would either redesign these in flight or stack on quicksand.

M2 produces an engine + ECS that can host real systems without further architectural redesign. Witness: a multi-system playground demo that exercises `Res<Time>`, multi-component `Query<[Transform, ...]>`, parent-child propagation, `States` transitions (`OnEnter` / `OnExit` / `OnTransition`), run conditions (`runIf(inState(Playing))`), `Commands`-deferred mutations during query iteration, a `PluginGroup` with lifecycle hooks, and the existing M1 render pass still rendering through the new schedule. Single-threaded throughout — there is no concurrency story.

This is a documentation-and-execution milestone. The seven backlog items under `## Phases` are the executable work. The future-direction roadmap files this milestone references (`scenes-and-prefabs`, `reflection-and-serialization`, `ui-system`, `observers-and-events`, `change-detection`, `transform-and-hierarchy`) are sketches kept on-paper so M3+ has somewhere to land.

## Phases

Each phase is a `docs/backlog/*.md` item with its own acceptance criteria. Ordering matters: 1 unblocks 2-8; 2 unblocks 3; 4 ships standalone but is consumed by 6 and 7; 5 depends on 2; 6 depends on 2 + 4 + 5; 7 is the integration phase pulling on every prior phase; 8 lands alongside 7.

1. **System param protocol** — pick the TS-friendly shape `(Res, ResMut, Query, Commands, …)` snap into. ADR-0006 at execution. → `docs/backlog/system-param-protocol.md`
2. **Resource registry** — global `Res<T>` / `ResMut<T>` on `App` / `World`; first thing that lets plugins share state without closures. → `docs/backlog/engine-resource-registry.md`
3. **Time resource** — `Time` with `virtual` / `real` clocks; first real consumer of the registry. → `docs/backlog/engine-time-resource.md`
4. **Archetype World + queries** — real archetype graph + column storage + multi-component `Query`; folds in Required Components and the `Disabled` marker. → `docs/backlog/ecs-archetype-world.md`
5. **Schedule + States + run conditions** — full Main + FixedMain + state schedules; `States` enum, `NextState<S>`, `runIf(inState(S))`, state-scoped resources first-class. → `docs/backlog/engine-schedule-and-states.md`
6. **Commands buffer** — `Commands` system param for deferred structural mutations; deterministic flush at stage boundaries. → ADR-0009. ✅ Done.
7. **Transform + Hierarchy** — `Transform` (one component, `Vec3 + Quat + Vec3`), `GlobalTransform`, `Parent`, `Children`, propagation in `PostUpdate`. First end-to-end exercise of every prior phase. → ADR-0010. ✅ Done.
8. **Plugin lifecycle** — `Plugin` interface with `build` / `ready` / `finish` / `cleanup` / `isUnique` / `name`; `PluginGroup` with ordered `add` / `disable` / `set`. → `docs/backlog/engine-plugin-lifecycle.md`

## Open questions

These are decided at execution time, not now. Listed so the team has a single place to track them.

- **TS param shape.** Tuple-of-tokens (`addSystem(stage, [Res(T), Query([A, B])], fn)`) is the leading candidate; factory and decorator alternatives are weighed in ADR-0006. The decision shapes every other phase's user-facing API.
- **`Stage` enum vs named `SystemSet` labels.** Today's string-union `Stage` survives M2 as the canonical stage names; whether systems within a stage organize via free-form string labels or a `SystemSet` symbol-class is decided in phase 5.
- **Change detection in v1.** `Changed<T>` / `Added<T>` are sketched in `docs/roadmap/change-detection.md` but **not implemented in M2**. Generation-counter columns are designed into the archetype storage from day 1 so the impl can land without re-storaging.
- **Schedule type — single or split.** `Main` and `FixedMain` are separate schedules at runtime; whether they're separate TS types or one parameterized type is an execution-time decision.
- **State-scoped resource cleanup ordering.** Does the resource get removed before or after user `OnExit` systems run? Recommended default: removal after user `OnExit`, so user code can read the resource one last time. Locked at execution.
- **Observer + Hook impl in M2 or M3.** Designed in `docs/roadmap/observers-and-events.md`. **Not in M2** unless phase 7's hierarchy work demands it (e.g., recursive despawn-on-remove-parent). Re-evaluate when phase 7 starts.

## Out of scope for M2

- Observer / hook implementation (designed in `observers-and-events.md`, deferred).
- Reflection / serialization implementation (designed in `reflection-and-serialization.md`, deferred).
- Scenes / prefabs implementation (designed in `scenes-and-prefabs.md`, deferred).
- Change detection implementation (designed in `change-detection.md`, deferred).
- Any sprite, input, audio, UI, or asset-system work.
- SubApp / logical-world isolation.
- Web Workers, SharedArrayBuffer, any concurrency story.
- Sparse-set storage sidecar — see `docs/roadmap/ecs-storage.md`.
- Additional system params beyond the core set — see `docs/roadmap/system-params.md`.

## Links

- ADR-0001 (composition-only ECS/engine — systems are functions, plugins are functions/objects, no inheritance hierarchy)
- ADR-0005 (archetype storage — phase 4 is the execution of that decision)
- The eight backlog files listed under "Phases" above.
- Future direction this milestone unblocks:
  - `docs/roadmap/scenes-and-prefabs.md` — uses `States`, Required Components, `Commands` from M2.
  - `docs/roadmap/reflection-and-serialization.md` — foundation for scenes.
  - `docs/roadmap/observers-and-events.md` — depends on deterministic Commands flush.
  - `docs/roadmap/change-detection.md` — depends on generation counters baked into archetype storage.
  - `docs/roadmap/transform-and-hierarchy.md` — extensions beyond the M2 baseline.
  - `docs/roadmap/ui-system.md` — uses `States` for screen state, hierarchy for layout.
- Rewritten with M2 baseline assumed:
  - `docs/roadmap/ecs-storage.md` — now "perf + ergonomics beyond M2 baseline".
  - `docs/roadmap/system-params.md` — now "additional param kinds beyond M2 baseline".
  - `docs/roadmap/asset-system.md` — Scene-system phase split out to `scenes-and-prefabs.md`.
- Bevy prior art (informing, not dictating):
  - Required Components ([Bevy 0.15 release notes](https://bevy.org/news/bevy-0-15/))
  - States + run conditions ([bevy-cheatbook: states](https://bevy-cheatbook.github.io/programming/states.html))
  - Plugin lifecycle ([docs.rs/bevy `Plugin`](https://docs.rs/bevy/latest/bevy/app/trait.Plugin.html))
  - Schedule structure ([bevy-cheatbook: schedules](https://bevy-cheatbook.github.io/programming/schedules.html))
  - Command queue determinism ([Bevy 0.15→0.16 migration](https://bevy.org/learn/migration-guides/0-15-to-0-16/))
