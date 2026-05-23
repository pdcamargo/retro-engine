---
'@retro-engine/engine': minor
---

feat(engine): Plugin lifecycle + plugin groups (M2 phase 8)

Closes M2 by upgrading the `Plugin` surface from `(app: App) => void` to a Bevy-shaped lifecycle:

- `PluginObject` — canonical interface with `name()`, optional `isUnique()`, `build(app)`, optional `ready(app)`, `finish(app)`, `cleanup(app)`. The new shape for class plugins.
- `Plugin` is now a public union `PluginObject | PluginFn` so the M1 `trianglePlugin` (annotated `: Plugin = (app) => {...}`) and the inline studio function plugin compile unchanged.
- `App` carries a plugin state machine — `Building` → `Ready` → `Cleaned`. The first call to `advanceFrame` (or `run`) ticks the lifecycle: polls every plugin's `ready()`, then runs `finish()` and `cleanup()` in registration order. Synchronous plugins traverse all three states on the first frame. `addPlugin` after the machine leaves `Building` throws.
- Function-callback plugins are auto-wrapped at `addPlugin`: named functions become unique by `fn.name`, anonymous lambdas are non-unique. Uniqueness for class plugins is keyed on `name()` (default `this.constructor.name`-style).
- `PluginGroupBuilder` with `.add`, `.disable<T>(ctor)`, `.set<T>(ctor, replacement)`, `.build(): PluginObject[]`. `PluginGroup` interface for shippable bundles. `app.addPlugins(input)` accepts `PluginObject[]`, a `PluginGroup`, or a `PluginGroupBuilder` directly.
- `CorePlugin` — built-in plugin registered first by the `App` constructor. Inserts the `Time` resource, registers `Time.tick` in `'first'`, and registers `propagateTransforms` in `'postUpdate'`. Replaces the prior inline constructor wiring; observable behavior is unchanged (Time is still live immediately after `new App({...})`).

Single-threaded throughout. Sealed in ADR-0011.
