# System Params (additional kinds beyond M2 baseline)

- **Created:** 2026-05-21
- **Status:** Future direction (sketch — M2 ships the protocol + core params)

## Goal

M2's `docs/backlog/system-param-protocol.md` decides the TypeScript-friendly param shape (ADR-0006 at execution time), and the M2 phases together implement the **core params**: `Res<T>` / `ResMut<T>`, `Query<[...]>` (with filter shapes `With` / `Without` / `Has`), `Commands`, and the stage-scoped render context. That's the baseline.

This roadmap captures **additional param kinds** that don't ship in M2 but are likely useful later. Each is a sketch; promote when a real consumer asks for it.

## Phases

1. **`Local<T>`** — per-system persistent state, initialized lazily on first run (default-constructed or via a factory). Used for accumulators (frame counters), incremental algorithms, system-private caches. Bevy's analog: `Local<T>`.
2. **`MessageReader<T>` / `MessageWriter<T>`** — frame-buffered message channels. Designed in `docs/roadmap/observers-and-events.md`; this is the param-shaped surface for it.
3. **`Trigger<E>`** — observer system param. Carries the event payload + target entity. Same `observers-and-events.md` initiative.
4. **`NextState<S>`** — state-transition request resource. M2 ships this for free as `ResMut<NextState<S>>`, but a dedicated param shape (`NextState<GameState>` directly) is cleaner sugar.
5. **`EventReader<E>` / `EventWriter<E>`** — name-collision check: in our vocabulary (matching Bevy 0.17+), `Event` is the observed/triggered kind, not the buffered kind. So this phase is *not* a renamed `Message` channel — it's the param-shaped writer/reader for triggered events that bypass observers and accumulate for explicit reading. May not be needed; flagged in case it falls out of the observer impl.
6. **Stage-scoped params** — generalization of the current `RenderContext` shape. A param that's only resolvable during a specific stage (e.g., a render pass param during `Render`, a state-transition context during `OnEnter` / `OnExit`). M2 keeps the existing render-context surface; this phase formalizes the "params per stage" mechanism.
7. **Schedule-scoped resources** — resources that exist only while a particular sub-schedule is running. Niche; defer until a clear use case.
8. **Query iterators with state — `QueryState<T>`** — Bevy's escape hatch for systems that need to interact with a query outside of normal injection (e.g., from an exclusive system or a closure). Probably not needed in our shape; flagged for completeness.
9. **Exclusive `&mut World` params** — for systems that need full unfettered world access (scene loading, replay capture). Single-threaded TS makes this cheap to provide; the question is the API shape and whether to make exclusive-ness explicit at the param level or the registration level.

## Open questions

- **Param token interning.** If every `Res(Foo)` call is a fresh object, registration is allocation-heavy. Param tokens should be cached per type — `Res(Foo)` returns the same descriptor every time. Decide at execution.
- **`Local<T>` initialization timing.** Default-construct on first system run, or eagerly on `addSystem` call? Bevy: first run. We probably follow.
- **Async system params.** Some params resolve async (e.g., an asset handle that loads on demand). Out of scope for v1.
- **System params for observer systems.** Observer system functions are systems too — but with `Trigger<E>` and possibly a constrained set of other params. The constraint set is decided as part of observers-and-events.

## Links

- M2 protocol decision: `docs/backlog/system-param-protocol.md` (ADR-0006 at execution)
- M2 baseline params: `docs/backlog/engine-resource-registry.md`, `docs/backlog/ecs-archetype-world.md`, `docs/backlog/engine-commands-buffer.md`, `docs/backlog/engine-schedule-and-states.md`
- Related: `docs/roadmap/observers-and-events.md` (`MessageReader/Writer`, `Trigger`)
- Related: `docs/roadmap/change-detection.md` (`Res<T>.isChanged()`)
- ADR-0001 (composition — no `SystemBase` class)
- ADR-0005 (archetype storage — query is the param consumer that justifies the protocol)
- External:
  - Bevy `SystemParam` ([docs.rs/bevy_ecs](https://docs.rs/bevy_ecs/latest/bevy_ecs/system/trait.SystemParam.html))
  - Bevy `Local<T>` ([bevy-cheatbook](https://bevy-cheatbook.github.io/programming/local.html))
  - Bevy 0.17 `Event` → `Message` rename ([0.16→0.17 migration](https://bevy.org/learn/migration-guides/0-16-to-0-17/))
