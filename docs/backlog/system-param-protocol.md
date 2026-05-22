# System Param Protocol

- **Created:** 2026-05-21

## Context

The engine's current system signatures are hand-typed: `SystemFn = (world: World) => void` and `RenderSystemFn = (world: World, ctx: RenderContext) => void`, with an overload on `addSystem`. This shape is load-bearing — every new stage or new param kind (resources, time, queries, deferred commands) forces another signature alongside the old ones.

This backlog item picks the **TypeScript-friendly param protocol** the rest of the engine-foundations milestone (resources, time, queries, commands, run conditions) snaps into. Bevy resolves params via macros over Rust function signatures; TypeScript has no equivalent, so we pick a JS-native shape. Candidates worth weighing:

```ts
// A) Tuple of param tokens alongside the function (JS-native, verbose)
app.addSystem('update', [Res(Time), Query([Transform, Sprite])], (time, q) => { ... });

// B) Builder/factory that wraps the function with declared params
app.addSystem('update', system(Res(Time), Query([Transform, Sprite]), (time, q) => { ... }));

// C) Decorator metadata on class-style systems
@system('update') class MoveSprites { @res time: Time; @query([Transform, Sprite]) q; run() { ... } }

// D) JSDoc-driven (read at registration via TS reflection)
//    Almost certainly rejected — fragile and tooling-dependent.
```

The decision is captured in **ADR-0006** during execution, not here. The protocol must support: `Res<T>` / `ResMut<T>`, `Query<[...]>`, `Commands`, `Local<T>` (later), `MessageReader<T>` / `MessageWriter<T>` (later), and stage-scoped params like the current `RenderContext`. Run conditions (`runIf(...)`) are a separate shape that composes alongside params.

## Why deferred

This is M2 phase 1 — first piece of work in the engine-foundations milestone. It's the integration point every other phase depends on, so it lands before resource registry, query, commands, schedule, or plugin lifecycle work begins. Nothing else in M2 is unblocked until this is decided and merged.

## Acceptance

- ADR-0006 is written and accepted, naming the chosen protocol and the rejected alternatives with one-line reasons each.
- `packages/engine` exports the new system registration surface; the old `SystemFn` / `RenderSystemFn` overload is deleted.
- `apps/playground`'s triangle plugin compiles and renders unchanged through the new shape.
- `packages/engine/src/index.test.ts` covers: registering a system with zero params; registering with `Res<Foo>` (using a stub resource); registering a render system that consumes the stage-scoped render context.
- Single-threaded execution. No mention of parallel scheduling or any concurrency primitive in the implementation or the ADR.

## Links

- Roadmap: `docs/roadmap/engine-foundations.md` (M2 umbrella, phase 1)
- ADR-0001 (composition-only ECS/engine — no base class for systems)
- ADR-0005 (archetype storage — query is the consumer that justifies the param shape)
- Sibling backlog items: every other `docs/backlog/engine-*.md` and `docs/backlog/ecs-archetype-world.md` depends on this landing first
- External: Bevy `bevy_ecs::system::SystemParam` for prior art ([docs.rs/bevy_ecs](https://docs.rs/bevy_ecs/latest/bevy_ecs/system/trait.SystemParam.html))
