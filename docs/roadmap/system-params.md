# System Param Injection

- **Created:** 2026-05-21
- **Status:** Planning

## Goal

Replace the hand-typed `SystemFn` / `RenderSystemFn` shape with a Bevy-style system-parameter injection model. A system declares what it needs (world queries, global resources, local state, a deferred-command buffer, and stage-specific contexts like an active render pass), and the scheduler resolves and passes those in. The shape of a stage stops being load-bearing — adding a new kind of stage no longer requires a new function signature alongside the old ones.

Done state: every existing system can be expressed by declaring its params, the engine resolves them at call time, and adding a new stage or a new param kind (e.g. local resource, schedule-scoped resource) doesn't touch any existing system's signature.

## Phases

1. **Param protocol** — minimal `SystemParam` interface (or equivalent TS shape) that lets the scheduler ask "what do you need?" before each call. Decide whether params are described via decorators, factory functions, type tokens, or constructor metadata. TS doesn't have Rust's trait/macro machinery — picking the JS-friendly shape is the headline decision and probably warrants an ADR.
2. **Core params: `World`, `Commands`, `Res<T>`, `ResMut<T>`, `Local<T>`** — the smallest set that subsumes today's `(world) => void` and `(world, ctx) => void`. `Commands` is the deferred-mutation buffer (entity spawn/despawn/component add-remove batched and applied at a sync point).
3. **Resource registry on `App` / `World`** — global resources live somewhere the scheduler can resolve them from. Decide ownership (App vs World; one map or per-scope), insert API, removal semantics, change detection (if any in v1).
4. **Stage-scoped params** — `RenderPassParam` (or similar) replaces today's `RenderContext` second arg. Stage-scoped params are scheduler-injected only when the stage is active, so a render system that asks for a render pass is naturally skipped when there's no surface.
5. **Migrate existing systems** — rewrite the playground triangle plugin against the new shape; delete `RenderSystemFn` and the `addSystem` overload from `engine`; the `SystemFn` `(world) => void` shape goes too. ADR-0006 (deferred from `first-render-path.md`) gets written here, codifying the chosen shape.
6. **Query as a param** — `Query<[ComponentA, ComponentB]>` resolved against the world. Likely depends on the archetype storage milestone landing first (`ecs-storage.md`), since query performance is the whole point of that work.

## Open questions

- **Param description in TS without macros.** Bevy reads function signatures via macros; we can't. Options: (a) declare params as a tuple/array of param tokens alongside the function (`addSystem('render', [Res(Time), Query([Transform])], (time, q) => {...})`); (b) decorate the function with metadata; (c) read JSDoc-style annotations at registration; (d) require systems to be classes with a static `params` field. (a) is most JS-native and probably wins, but it's verbose. Decide before Phase 1.
- **`Commands` flush points.** Bevy flushes between stages. Do we match? If a system spawns an entity, when can downstream systems see it? Frame-end vs stage-end vs explicit barrier.
- **Global vs local resources.** Globals on `App` / `World`. Locals (`Local<T>`) are per-system state initialized lazily on first run. Do we need *schedule-local* resources too (a resource that exists only while a particular sub-schedule is running)? Premature for v1 — flag for re-evaluation.
- **Stage-scoped params vs explicit stage typing.** Today's overload (`addSystem('render', RenderSystemFn)`) is a type-level guard. Once params are dynamic, the guard moves to runtime: "this param is only resolvable during the render stage." Cost is a runtime error if a system declares a render param but is registered to a non-render stage. Acceptable in dev; consider asserting at registration time.
- **Compatibility with the future render graph.** `renderer-graph.md` adds multiple render passes. A `RenderPassParam` that resolves to "the active pass" needs to know which pass within the graph. Likely deferred until the render-graph initiative actually starts.

## Links

- ADR-0001 — composition-only ECS/engine; informs the no-base-class shape of systems.
- ADR-0005 — ECS archetype storage; query-as-param depends on it.
- `docs/roadmap/first-render-path.md` — the `RenderSystemFn`/`SystemFn` split this initiative undoes; open question about render-stage system signature lives there until this lands.
- `docs/roadmap/ecs-storage.md` — archetype storage; query-as-param depends on it landing first.
- `docs/roadmap/renderer-graph.md` — multi-pass rendering; reshapes what a "render param" resolves to.
- Bevy `bevy_ecs::system::SystemParam` and `bevy_ecs::system::Commands` for prior art.
