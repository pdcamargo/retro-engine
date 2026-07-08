# ADR-0173: Web game-runtime baseline + startup-scene loading

- **Status:** Accepted
- **Date:** 2026-07-08

## Context

A project's `ProjectDefinition` declares only **game logic** plugins (e.g. the
studio's sample project is `[HealthPlugin, ModelRefPlugin]`). It does **not**
declare the rendering stack (`MaterialPlugin`, lights, skybox) or the scene/asset
runtime (`ScenePlugin`, mesh/image/material/glTF loaders). In the studio those are
supplied by the editor host (`setupViewportScene` / `installProjectRuntime` in
`apps/studio`), and the authored world is loaded from the project's startup
`.rescene`.

The web export (`@retro-engine/runtime-web` `bootWebGame`, ADR-0153) had neither:
it added `CorePlugin` (auto) + the project's own plugins, then ran. For a
code-driven project that spawns everything in `startup` systems (e.g.
`apps/sample-game`) this renders. For a **scene-driven** project — the studio's
normal workflow, where entities live in a `.rescene` — the exported game booted
to an **empty world** (black screen, 0 errors): no baseline to render with, and
no scene loaded. This blocked the Export P0 item for real games.

## Decision

`bootWebGame` composes a **game-runtime baseline** and **loads the project's
startup scene**, mirroring what the studio host provides minus the editor-only
pieces:

- A new `installGameRuntime(app, { material })` in `@retro-engine/runtime-web`
  adds the non-editor render baseline (`PrepassPlugin`, `StandardMaterialPlugin`,
  the `MaterialPlugin(StandardMaterial)` instance, `Light3dPlugin`, `SkyboxPlugin`,
  `EnvironmentMapPlugin`, an `AmbientLight` resource) plus the scene/asset runtime
  (`ScenePlugin`, `Meshes`/`Images` stores, `.rmesh`/`.hdr`/image loaders,
  `registerMaterialLoaders`, `GltfPlugin`). Every plugin/resource add is
  **guarded** — skipped if the project already added its own — so a project can
  opt into a different material type or light setup without double-wiring.
- `bootWebGame` gains a `startupScene` option (a scene GUID). When present, after
  wiring `.rpak` assets and the project's plugins it installs the game runtime,
  then `loadByGuid` → `settle` → `applyCompletedLoads` → `spawnScene`, before the
  run loop. Scene-referenced assets (meshes, materials, glTF) stream from the
  `.rpak` on demand, exactly as in the studio.
- The web export threads `descriptor.startupScene` from `runWebExport` →
  `WebExportTarget` → `emitWebBoot` into the generated boot entry's
  `bootWebGame(..., { startupScene })` call. The startup `.rescene` is packed into
  the `.rpak` by the existing `.meta`-driven asset scan.
- `@retro-engine/runtime-web` gains a `@retro-engine/gltf` dependency (a web game
  with glTF models needs the loader at runtime).

The baseline + scene-loading helper lives in `runtime-web`, **not** shared with
the studio's editor-flavored `installProjectRuntime`/`setupViewportScene` yet —
deduping the two (likely by having the studio consume the runtime-web helper) is
a tracked follow-up, deferred to avoid coupling the editor to `runtime-web` in
this slice.

## Consequences

- Scene-driven projects export to a runnable web build — the studio's real
  workflow, not just code-driven demos. Unblocks the Export P0 item.
- The web runtime now has an opinion about the default render stack
  (`StandardMaterial` + a standard light/skybox set). A project wanting a
  different stack adds its own plugins; the guards keep those authoritative.
- Two copies of the "install project scene runtime" logic exist (studio +
  runtime-web) until the dedup follow-up lands — a maintenance cost accepted to
  keep this slice self-contained.
- `runtime-web` → `gltf` adds glTF/WASM-free loader code to the game bundle only
  when a project ships glTF; the dependency is unconditional but tree-shaking
  drops unused paths.

## Implementation

- `packages/runtime-web/src/game-runtime.ts` — `installGameRuntime`, `loadAndSpawnScene`
- `packages/runtime-web/src/boot.ts` — `bootWebGame` `startupScene` option
- `packages/build/src/web-boot.ts` — `emitWebBoot` `startupScene` option
- `packages/build/src/web-export-target.ts` / `run-export.ts` — thread `descriptor.startupScene`
- `docs/roadmap/web-game-runtime.md` — phased plan + follow-ups
