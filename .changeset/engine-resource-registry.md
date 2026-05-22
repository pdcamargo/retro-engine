---
'@retro-engine/engine': minor
---

Engine logger + resource registry phase 2.

- **Engine logger** (per ADR-0007). New `Logger` interface (`error` / `warn` / `info` / `debug` / `devWarn` / `child(category)`), default `ConsoleLogger` impl exported as `createConsoleLogger()` and the shared `engineLogger`. `App` now owns `logger: Logger` (field) and accepts `AppOptions.logger` to override the default. Consumers (studio, Tauri panels, telemetry sinks, tests) replace the engine's diagnostic sink at App construction with no engine-side code changes. `devWarn` is the dev-only advisory channel — silent when `NODE_ENV === 'production'`, emits otherwise. The other four severities always emit. Leaf packages (`renderer-*`, `ecs`, `math`) intentionally do not depend on the logger; they surface failures by throwing self-contained, package-prefixed `Error`s and the engine logs at the boundary.
- **Resource registry phase 2.** New `App.removeResource(ctor): T | undefined` (Bevy-aligned return, idempotent). New `ResMut(ctor)` factory — the symmetric write twin of `Res(ctor)`, separate cache so `Res(Foo) !== ResMut(Foo)` and a future schedule graph can distinguish read vs. write intent. `Res<T>` now resolves to `DeepReadonly<T>` at the type level, so shallow and nested mutations through a `Res<T>` reference are compile errors; `ResMut<T>` keeps the live, writable type. Runtime behaviour is identical between the two — both return the same registered instance. `App.insertResource` now emits a `devWarn` through the App logger when replacing an existing resource of the same constructor key (silent in production). The missing-resource error is more actionable: `Res(Foo): resource not registered — did you forget app.insertResource(new Foo())?` (analogous wording for `ResMut`).
- `@retro-engine/engine` re-exports `Logger`, `engineLogger`, `createConsoleLogger`, and `ResMut`.

Migration: existing `Res(T)` call sites that *only* read a resource keep working unchanged. Call sites that *write* through `Res(T)` must switch to `ResMut(T)` — the runtime behaviour is identical, but `Res<T>` is now read-only at the type level.
