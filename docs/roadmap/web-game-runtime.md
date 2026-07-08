# Web game runtime (baseline + scene loading)

Makes the web export run a **scene-driven** game, not just a code-driven one.
Authoritative decision: [ADR-0173](../adr/ADR-0173-web-game-runtime-baseline-and-scene-loading.md).

Context: a project's `ProjectDefinition` holds only game-logic plugins; the render
stack + scene/asset runtime are supplied by the host. The studio host provides
them (`setupViewportScene` + `installProjectRuntime`); the web runtime did not, so
a scene-driven export booted to an empty world. This closes that gap.

## Phases

- **Phase 1 — baseline + scene load (ADR-0173).** ✅ `installGameRuntime` (render
  baseline + scene/asset runtime, guarded) + `loadAndSpawnScene` in
  `@retro-engine/runtime-web`; `bootWebGame` `startupScene` option; the export
  threads `descriptor.startupScene` through `emitWebBoot`. Verified headless
  (a spawned scene populates the world) + a scene-driven export booted in a browser.
- **Phase 2 — dedup with the studio.** The studio's `installProjectRuntime` /
  `setupViewportScene` overlap the runtime-web helper. Extract a shared
  "project scene runtime" both consume (likely the studio depending on the
  runtime-web helper), so the baseline is defined once.
- **Phase 3 — configurable baseline.** Let a project opt into a different material
  type / light setup / skybox without hand-adding every plugin — e.g. a
  `defineProject({ runtime: {...} })` hint or a `DefaultGamePlugins` group the
  project spreads. Today the guards let a project override by adding its own
  plugins first; this makes it first-class.
- **Phase 4 — production polish.** Source maps / minification pass on the export
  (phase 6 of the web target), plus a loading UI while the startup scene's assets
  stream from the `.rpak`.
