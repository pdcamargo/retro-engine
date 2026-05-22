# Engine Plugin Lifecycle

- **Created:** 2026-05-21

## Context

The current `Plugin` shape is `(app: App) => void` — one hook, no lifecycle, no uniqueness guarantee, no grouping. This was enough for M1's single `trianglePlugin` but breaks down as soon as plugins depend on one another. Common cases the current shape can't express:

- Plugin A reads a resource Plugin B inserts → A must run after B's `build`.
- A "default plugins" group with stable ordering (Bevy's `DefaultPlugins`).
- Plugin C must initialize *after* every other plugin's `build` finishes — to register itself last.
- A plugin that should appear at most once, with a clean error on accidental double-add.

This backlog item upgrades `Plugin` to a richer interface, modeled on Bevy's plugin trait, and adds `PluginGroup` for ordered grouping.

```ts
// Approximate surface.
interface Plugin {
  name(): string;
  isUnique?(): boolean;       // default true
  build(app: App): void;       // primary registration hook
  ready?(app: App): boolean;   // default true; if false, finish is delayed
  finish?(app: App): void;     // runs after every plugin's build completes and is ready
  cleanup?(app: App): void;    // runs after finish; rare; for one-shot teardown of build-time resources
}

class PluginGroupBuilder {
  add(plugin: Plugin): this;
  disable<P extends Plugin>(ctor: new () => P): this;
  set<P extends Plugin>(ctor: new () => P, replacement: P): this;
  build(): Plugin[];
}

interface PluginGroup {
  build(): PluginGroupBuilder;
}

// Usage
app.addPlugin(new TrianglePlugin());
app.addPlugins(new DefaultPlugins().build().disable(LogPlugin).build());
```

App plugin state machine: **Building → Ready → Cleaned**. Plugins added after `Cleaned` error. `isUnique()` returning true means adding a second instance of the same plugin class errors at registration.

Function-style plugins (the current `(app) => void` shape) remain supported via a wrapper — `addPlugin(fn)` auto-wraps into a minimal `Plugin` with `build === fn` and `name === fn.name`. Existing call sites keep working.

## Why deferred

M2 phase 8. Doesn't strictly depend on the other M2 phases — could be done first. Ordered last because the *consumers* of the lifecycle hooks (resource registry, schedule, etc.) need to exist for the hooks to do anything useful. Lands alongside phase 7 (transform-hierarchy) at execution time.

## Acceptance

- `packages/engine` exports a `Plugin` interface with `name`, `build`, optional `ready`, `finish`, `cleanup`, `isUnique`.
- `App` tracks a plugin state machine (`Building` → `Ready` → `Cleaned`).
- `app.addPlugin(p)` calls `p.build(app)` during the `Building` phase. Adding after `Cleaned` errors.
- `app.run()` waits for every plugin's `ready()` to return true (with a reasonable retry / timeout policy documented), then calls each plugin's `finish()` in registration order, then `cleanup()` in registration order.
- `isUnique()` defaulting to true: adding two instances of the same plugin class errors at the second `addPlugin` call.
- `PluginGroupBuilder` supports `.add`, `.disable<T>`, `.set<T>(replacement)`. Final `.build()` returns the ordered plugin list.
- `app.addPlugins(group_or_array)` registers them in order.
- Function-style plugins still work (auto-wrap path); the M1 `trianglePlugin` compiles without modification.
- Tests cover: lifecycle order (`build` → `ready` → `finish` → `cleanup`); unique error; group ordering with disable/replace; function-plugin auto-wrap.
- Implementation is single-threaded; no async lifecycle hooks unless explicitly necessary for `ready()` (in which case `ready` returning a `Promise<boolean>` is acceptable and documented).

## Links

- Roadmap: `docs/roadmap/engine-foundations.md` (M2 umbrella, phase 8)
- ADR-0001 (plugins are how features extend the App — no `AbstractPlugin` class)
- Prereqs: none strict within M2; benefits from phases 2/4/5 being landed so lifecycle hooks have things to do.
- Consumers (post-M2): every future feature plugin (sprite rendering, input, scenes/prefabs, asset system, studio integration).
- External: Bevy `Plugin` trait ([docs.rs/bevy](https://docs.rs/bevy/latest/bevy/app/trait.Plugin.html)), Bevy `PluginGroup` ([docs.rs/bevy](https://docs.rs/bevy/latest/bevy/app/trait.PluginGroup.html)), `DefaultPlugins` composition ([bevy-cheatbook](https://bevy-cheatbook.github.io/programming/plugins.html))
