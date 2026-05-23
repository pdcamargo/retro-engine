# ADR-0011: Engine Plugin Lifecycle

- **Status:** Accepted
- **Date:** 2026-05-22

## Context

Through M2 phases 1–7, every consumer-extending feature was a one-shot function: `type Plugin = (app: App) => void`, invoked synchronously inside `App.addPlugin`. That shape was enough for M1's single `trianglePlugin` and the phase-7 hierarchy demo, but it cannot express the things future plugins (sprite renderer, input, asset loader, scene loader, studio panels) need from one another:

- Plugin A must observe every other plugin's `build` effects before doing its own late wiring.
- A bundle of "default plugins" must surface as a single composable unit with stable ordering and per-plugin overrides.
- A plugin should be at most-once by default — accidental double-registration should fail loudly.
- A plugin with async setup (a shader fetch, a config load) must gate the rest of the lifecycle until ready, without making the schedule itself async.

Phase 8 closes M2 by upgrading the `Plugin` surface to a Bevy-shaped lifecycle (`build` / `ready` / `finish` / `cleanup`) plus a `PluginGroupBuilder` for grouping. After this phase the engine + ECS surface is the one consumers build on indefinitely, so the API must be right before consumers ossify around it.

Bevy is the prior art (`bevy::app::Plugin`). We diverge where the divergence is deliberate — flagged in each decision below. Single-threaded throughout, matching every other M2 phase.

## Decision

### 1. The `PluginObject` interface

```ts
interface PluginObject {
  name(): string;
  isUnique?(): boolean;
  build(app: App): void;
  ready?(app: App): boolean;
  finish?(app: App): void;
  cleanup?(app: App): void;
}
```

New code writes `class MyPlugin implements PluginObject { ... }`. `build` is the only required hook; the rest are opt-in. `name()` is the uniqueness key (decision 6). The legacy `(app: App) => void` shape stays supported via auto-wrap (decision 10), so the M1 `trianglePlugin` compiles unchanged.

### 2. App plugin state machine: `Building → Ready → Cleaned`

The `App` carries a `pluginsState: PluginsState` field, initially `'Building'`. The trigger to advance the machine is the **first call to `advanceFrame`** (decision 3). At the start of that frame, before any system runs, the App polls every plugin's `ready()`; when all report true, the App runs `finish(app)` for each in registration order, transitions to `'Ready'`, runs `cleanup(app)` for each in registration order, and transitions to `'Cleaned'`. For synchronous plugins (the common case), all three transitions happen on the first frame before the schedule runs.

### 3. State transition trigger — first `advanceFrame()`

`app.run()` calls `advanceFrame` internally (once at startup, then once per `requestAnimationFrame` callback). Making `advanceFrame` the trigger unifies the test-drive and production-drive paths and — critically — makes the state machine *visible in tests*, which step the schedule synchronously via `advanceFrame(ms)`. Were `run()` the only trigger, every existing engine test would stay in `'Building'` forever and lifecycle regressions would hide there.

Bevy uses the same model: `App::update` is what ticks the lifecycle.

### 4. `ready()` retry policy — sync `boolean`, per-frame poll, no timeout

`ready(app: App): boolean` is **synchronous**. v1 does not accept `Promise<boolean>` (the backlog allowed it; we tightened to sync only). Plugins with async setup hold the promise themselves, flip a private boolean in the resolved callback, and return that boolean from `ready()` — the same pattern Bevy uses.

The App caches a true result and stops polling that plugin (the lifecycle is single-shot per plugin). There is no frame-cap timeout in v1: a plugin that never returns true keeps the App in `'Building'` indefinitely, and its `finish` / `cleanup` never run. That symptom is loud enough — silent dropping would mask the bug. Plugins that need a deadline implement it inside their own `ready()` (e.g., devWarn after N polls and return true to give up gracefully).

### 5. `finish` / `cleanup` order — both registration order

Both hooks run in registration order, matching Bevy. We considered LIFO for `cleanup` ("destructor semantics") but rejected it: `cleanup` is **not** the plugin's end-of-life — it is for tearing down the plugin's *own* build-time scaffolding (e.g., a one-shot asset preload context the plugin allocated in `build` and no longer needs after `finish` has wired everything). Contract: a plugin's `cleanup` must not reach across the registry. If a plugin needs reverse-order destructor semantics for its own state, it implements that locally.

### 6. `isUnique` enforcement key — `Plugin.name()` string

Uniqueness is keyed on the string returned by `name()`. A second `addPlugin` whose plugin reports the same `name()` and reports `isUnique()` true throws at the second registration. Defaults:

- Class plugins typically return `this.constructor.name` from `name()`; `isUnique()` defaults to true.
- Auto-wrapped function plugins (decision 10): the wrapper's `name()` returns `fn.name` when non-empty; for an anonymous lambda, the wrapper generates `<anonymous-N>` and overrides `isUnique()` to false (uniqueness is meaningless for anonymous code — every `() => {...}` is its own distinct definition).

Rejected: class-identity keying. Works for classes but needs a separate code path for functions; `name()` is the one key that unifies both shapes.

### 7. Auto-registered systems — `CorePlugin`

The framework-essential systems (`Time` resource + `Time.tick` in `'first'` + `propagateTransforms` in `'postUpdate'`) move out of the `App` constructor's inline wiring and into a built-in `CorePlugin` that the constructor registers **first** — before any user `addPlugin` call can run. From the constructor caller's perspective nothing changes: `Time` is still available immediately after `new App({...})`, since `build()` runs synchronously inside `addPlugin`.

This establishes the precedent for every future engine-internal system — the renderer plugin, input plugin, asset loader, scene loader — to ship as a built-in plugin registered in the constructor. The engine becomes introspectable: enumerate plugins and you see the full set of systems the engine is running, including its own. Diverges from Bevy's split (`MinimalPlugins` / `DefaultPlugins` as user-facing groups) because Retro Engine's core systems are not opt-out at the consumer level.

### 8. Mid-game plugin addition — error after `Building`

`addPlugin` / `addPlugins` throw once `pluginsState !== 'Building'`. Bevy allows adds during its `Ready` and `Finished` substates and only errors after `Cleaned`; we tighten this to "all plugins must be registered before the first frame." Simpler contract, trivial implementation (one state check). The Bevy-style relaxed window only matters for plugins with async `ready`, which is rare; relaxing later is additive.

### 9. `PluginGroupBuilder` — class-identity API

```ts
class PluginGroupBuilder {
  add(plugin: PluginObject): this;
  disable<P extends PluginObject>(ctor: new () => P): this;
  set<P extends PluginObject>(ctor: new () => P, replacement: P): this;
  build(): PluginObject[];
}

interface PluginGroup {
  build(): PluginGroupBuilder;
}
```

`.disable<T>` and `.set<T>` match by class identity against each entry's `constructor`. `.set` throws if no entry matches (it is for *overriding* a known plugin, not adding a new one). Materialising the group is intentionally two-step:

```ts
app.addPlugins(new DefaultPlugins());                             // PluginGroup
app.addPlugins(new DefaultPlugins().build().disable(LogPlugin));  // PluginGroupBuilder
```

The double `.build()` (`.build()` returns the builder; the App calls `.build()` on the builder to get the `PluginObject[]`) lets callers tweak the builder between materialisations. Mirrors Bevy.

Consequence: **plugins inside a group must be classes, not functions** — `.disable` and `.set` need a constructor reference. Function-style plugins can still be passed directly to `app.addPlugin`; the group API simply doesn't accept them.

### 10. Function-callback auto-wrap

`Plugin` is a public union type:

```ts
type Plugin = PluginObject | PluginFn;
type PluginFn = (app: App) => void;
```

`app.addPlugin(plugin: Plugin)` accepts both. When a function is passed, the App wraps it in an internal `FunctionPlugin` whose `build(app)` calls the function. The wrapper carries `name()` and `isUnique()` per decision 6. This preserves every M1 + phase-7 call site verbatim: the M1 `trianglePlugin` (annotated `: Plugin = (app) => { ... }`) and the inline studio lambda (`app.addPlugin((a) => { ... })`) both compile and run without modification, even though the `Plugin` *type* meaning has changed.

Tooling note: when writing a new class plugin, declare `class MyPlugin implements PluginObject` — `Plugin` is a union and is not directly implementable.

### Rejected alternatives

- **`run()` is the only trigger for the lifecycle.** Tests step the schedule via direct `advanceFrame` calls. If `run()` were the only trigger, every existing engine test would stay in `'Building'` forever and the state machine would be invisible to the test surface — lifecycle regressions would survive into production. Rejected; `advanceFrame` is the trigger (decision 3).
- **`Promise<boolean>` from `ready()`.** Bevy is sync; v1 should be too. Async ready requires the schedule to become async or introduces a side-loop. Plugins with async setup can flip a sync flag in their resolved callback — that handles the rare case without contorting the common one.
- **LIFO cleanup ("destructor semantics").** Would mean reverse-of-registration order so plugin B's cleanup runs before plugin A's. But `cleanup` is not "destroy state at end-of-life" — it is "tear down the plugin's own build-time scaffolding." Plugins must not reach across the registry in cleanup; LIFO would imply they can.
- **Class-identity uniqueness key.** Works for classes but breaks for function-style plugins (they're all `Function`-typed). `name()` unifies; the wrapper for anonymous functions opts out of uniqueness, which is the correct behavior for anonymous code.
- **Keep `Time.tick` + `propagateTransforms` as constructor-time wiring outside the plugin system.** Slightly simpler boot order but creates a permanent two-track world ("framework systems live here; new systems via plugins"). Bad precedent given every other M2 system was registered uniformly through `addSystem`.
- **Allow `addPlugin` during `'Ready'` (Bevy-style relaxed window).** Only matters for plugins with async `ready`, which is rare. Tightening v1 keeps the contract crisp ("all plugins before the first frame") and the implementation trivial. Relaxing later is additive.
- **`Plugin` as the new interface (drop legacy function form from the type).** Forces a one-character source change on the M1 `trianglePlugin` (`: Plugin` annotation). The user's regression gate is that `trianglePlugin` compiles unchanged; we therefore make `Plugin` a union of `PluginObject | PluginFn`, with `PluginObject` as the new richer interface.

## Consequences

**Easier:**

- Every future feature (sprite rendering, input, asset loader, scene loader, studio integration) targets a single canonical extension shape (`PluginObject`) with well-defined hooks for build / ready / finish / cleanup.
- Plugin groups give consumers a stable API for "default plugins" bundles, with `.disable<T>()` and `.set<T>()` for overrides — the same ergonomic Bevy ships.
- The engine becomes introspectable: enumerate `pluginRegistry` and you see every system the engine is running (CorePlugin + user plugins).
- The state machine is visible to tests (decision 3) — lifecycle regressions surface in `bun test`, not only at runtime.
- M2 closes on a Plugin surface that is stable enough to depend on through M3 and beyond.

**Harder:**

- Two type names for the plugin concept: `PluginObject` (the interface) and `Plugin` (the union accepted by `addPlugin`). New code must use `implements PluginObject`; existing code annotated `: Plugin` continues to work. Documented in JSDoc and in this ADR.
- Mid-game plugin addition is forbidden (decision 8). If a concrete use case appears for late-add (a hot-reloaded plugin, a feature toggle), a follow-up ADR relaxes this — the relaxation is additive.
- `ready()` is sync only in v1. Plugins with async setup pay one indirection (a private flag flipped in a resolved callback). The Promise<boolean> hedge from the backlog is explicitly out of scope.

**Accepted trade-offs:**

- `CorePlugin` adds one indirection on top of the prior constructor-time wiring. The cost is one tiny class and one `addPlugin` call; the benefit is uniform precedent for every future engine-internal plugin.
- `PluginGroupBuilder` requires class-shaped plugins. Function-style plugins keep working via `addPlugin` but cannot be addressed by `.disable<T>` / `.set<T>` (no constructor to match against). This is intentional — groups are a class-plugin idiom.
- Diverges from Bevy on three deliberate points (decisions 4, 5, 7, 8 above). Each is documented inline with its rationale; rejected alternatives spell out what Bevy does and why we did not.

## Implementation

- `packages/engine/src/plugin.ts` — `PluginObject` interface, `PluginFn` type, `Plugin` union, `FunctionPlugin` (internal auto-wrap class), `wrapFunctionPlugin` helper, `PluginsState` type.
- `packages/engine/src/plugin-group.ts` — `PluginGroup` interface, `PluginGroupBuilder` class with `.add` / `.disable<P>` / `.set<P>` / `.build()`.
- `packages/engine/src/core-plugin.ts` — `CorePlugin` class implementing `PluginObject`; registers the Time resource, `Time.tick` system (`'first'`), and `propagateTransforms` system (`'postUpdate'`).
- `packages/engine/src/index.ts` — `App` class gains `pluginRegistry`, `pluginNameIndex`, `pluginsReadyFlags`, `_pluginsState`, `pluginsState` getter, `addPlugin(p: Plugin)` (replaces the prior function-only signature), `addPlugins(input)` accepting `PluginObject[]` / `PluginGroup` / `PluginGroupBuilder`, private `tickPluginLifecycle()` called at the top of `advanceFrame`, and a `currentFrameTimestamp()` accessor for engine-internal plugins. Re-exports `Plugin`, `PluginFn`, `PluginObject`, `PluginsState`, `PluginGroup`, `PluginGroupBuilder`. Constructor's prior inline Time/transform wiring is replaced by `this.addPlugin(new CorePlugin())`.
- `packages/engine/src/plugin.test.ts` — concern-scoped test coverage (build at addPlugin time; CorePlugin runs first; state machine `Building → Cleaned`; build/finish/cleanup registration order; `addPlugin` after first frame throws; `ready` polling and caching; uniqueness by `name()` for classes and named function plugins; anonymous function plugins are non-unique; function-callback auto-wrap).
- `packages/engine/src/plugin-group.test.ts` — `.add` ordering, `.disable<T>` removal, `.disable` no-op when no match, `.set<T>` position-preserving replace, `.set` throws when no match, `.build()` returns an independent snapshot, `app.addPlugins` accepting `Plugin[]` / `PluginGroupBuilder` / `PluginGroup`, group registration respects per-plugin uniqueness.
- `apps/playground/src/logging-plugin.ts` — `LoggingPlugin` class implementing all four lifecycle hooks with `app.logger.child('logging').info(...)` per phase. Class-shape witness.
- `apps/playground/src/main.ts` — wires `new LoggingPlugin()` alongside the unchanged `trianglePlugin` (function-callback) so both shapes run end-to-end in the playground.
