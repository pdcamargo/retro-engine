# Engine Resource Registry

- **Created:** 2026-05-21

## Context

The current `App` and `World` host components and systems but offer no way for plugins to share typed global state. Today, a plugin that needs to hold onto, say, a render pipeline handle is forced to capture it in a closure and shadow it across system registrations. This doesn't scale to `Time`, `Input`, `Camera`, asset stores, or anything else that systems need to read across stages.

This backlog item adds a **type-keyed resource registry** on `App` / `World`, exposed through the system param protocol as `Res<T>` (read-only) and `ResMut<T>` (mutable). It is the first piece of work that consumes the param protocol decided in the prerequisite backlog item.

```ts
// Approximate surface — exact API depends on the param protocol decision.
app.insertResource(new Time());
app.insertResource(new ClearColor({ r: 0, g: 0, b: 0, a: 1 }));

app.addSystem('update', [Res(Time)], (time) => {
  // time.delta, time.elapsed, time.frame
});
```

Resources are keyed by constructor (or registered symbol). Inserting twice for the same key replaces with a warning in dev (silent in production). Removal is allowed. `getResource(ctor)` returns `T | undefined`. State-scoped resources (resources that exist only while a `States` value is active) are a separate concern decided in the schedule-and-states backlog item.

The registry is single-threaded. No locks, no `RwLock`-equivalent, no `Send + Sync` ceremony — every access is a direct property read in the call site's stack.

## Why deferred

M2 phase 2. Depends on the system param protocol (phase 1) being decided, since `Res<T>` and `ResMut<T>` are the first params we ship. Everything after this (Time, Schedule + States transition data, Commands integration, plugin lifecycle hooks that insert resources) depends on the registry existing.

## Acceptance

- `packages/engine` exposes `App.insertResource(instance)`, `App.removeResource(ctor)`, `App.getResource(ctor)`.
- `packages/engine` exposes `Res(ctor)` and `ResMut(ctor)` param shapes that integrate with the system protocol.
- A system declaring `Res<Foo>` receives the live registered `Foo`; declaring it without an insertion fails with a clear "missing resource" error at registration or first run.
- Double-insertion replaces the previous value, with a `console.warn` in dev builds.
- Tests in `packages/engine/src/index.test.ts` cover insert/get/remove/replace/missing scenarios.
- No reference to threading, locks, atomics, or any concurrency primitive anywhere in the implementation, the tests, or the documentation comments.

## Links

- Roadmap: `docs/roadmap/engine-foundations.md` (M2 umbrella, phase 2)
- ADR-0001 (composition-only — resources are the composition unit for shared state)
- Prereq: `docs/backlog/system-param-protocol.md`
- Consumers: `docs/backlog/engine-time-resource.md`, `docs/backlog/engine-schedule-and-states.md` (state-scoped resources design), `docs/backlog/engine-commands-buffer.md`, `docs/backlog/engine-plugin-lifecycle.md`
- External: Bevy `Resource` trait ([docs.rs/bevy_ecs](https://docs.rs/bevy_ecs/latest/bevy_ecs/system/struct.Res.html))
