# ADR-0080: Studio scene-loading seam + showcase prototype

- **Status:** Accepted
- **Date:** 2026-06-16

## Context

The studio previously populated its viewport with hardcoded `cmd.spawn` demo
content and never exercised the engine's scene-loading path. To prove the editor
(ADR-0079's hierarchy + inspector) against real content, the studio needs (a) an
opinionated, host-agnostic point where "the scene to edit" comes from — one that
runs unchanged in the browser and under Tauri, per ADR-0078's posture of keeping
the host boundary out of the engine — and (b) a prototype scene that exercises
*every* content-production mechanism the engine supports, not just trivial
entities, so each is shown to round-trip into the live world the editor reads.

## Decision

- **A `SceneSource { load(): Promise<SceneData> }` seam** is the studio's entry
  point for obtaining a scene. The only implementation today is
  `inMemorySceneSource(data)`; the async signature exists so host-backed sources
  (a Bun dev endpoint, a Tauri file read) drop in later behind the same contract
  without the rest of the studio noticing. The model assets the showcase needs are
  bundle-imported, not host-loaded — the same "no host I/O yet" stance.
- **The bootstrap splits into editor-infra and authored content.**
  `setupViewportScene` keeps the editor cameras, grid, and lights (and takes the
  shared `MaterialPlugin<StandardMaterial>` instance so the showcase's `GltfPlugin`
  reuses it). `installShowcaseScene` adds the Asset/Scene/glTF plugins and a
  startup system that brings the showcase into the live world.
- **The showcase carries one of each mechanism**, mirroring the playground
  `composition` / `prefab` / `gltf` showcase plugins:
  - plain entities + a `Parent` hierarchy;
  - a **prefab-template** instance (`registerTemplate` + a `templates:[…override]`
    ref in the authored `SceneData`);
  - a **nested-scene** instance (a child `Scene` registered under a GUID; the mount
    entity carries `scene:{guid}`; one `resolveHandle` serves the scene ref and the
    child's asset handles);
  - a **glTF model**, spawned **programmatically** — `GltfSceneRoot` carries an
    asset handle and has no reflection schema, so it cannot live in a serialized
    scene. This is a deliberate, tracked gap, not an oversight.
- **The authored parent scene is the registry-independent `SceneData`** the
  `SceneSource` returns; templates, the child scene, and assets are registered at
  startup (they are the scene's dependencies, resolved here in code the way a
  project/manifest will resolve them later).

## Consequences

- The studio now loads a scene through the real `spawnScene` path, so the editor
  is proven against authored entities, a prefab expansion, a live nested-scene
  instance, and an imported glTF node tree — all surfaced uniformly by ADR-0079's
  reader.
- The studio gains `@retro-engine/gltf` and `@retro-engine/assets` dependencies, an
  `AssetPlugin` with a bundled model source, and a copy of the `Clover_1` model. No
  Tauri rebuild and no `dev-server.ts` change: the model is bundle-imported, so it
  works under both `bun build` (browser) and the Tauri dev frontend.
- Host-specific `SceneSource` providers (browser endpoint, Tauri file) are deferred
  (`docs/backlog/studio-scene-source-host-providers.md`), as is persisting glTF
  instances in scenes (`docs/backlog/serialize-gltf-scene-root.md`).
- The existing hardcoded demo primitives in `setupViewportScene` remain for now;
  they and the showcase both appear in the live hierarchy.

## Implementation

- `apps/studio/src/scene-source.ts` — `SceneSource`, `inMemorySceneSource`
- `apps/studio/src/showcase-scene.ts` — `SHOWCASE_SCENE`, `installShowcaseScene`, `ShowcaseDeps`
- `apps/studio/src/scene-bootstrap.ts` — `setupViewportScene` (takes the shared `MaterialPlugin`)
- `apps/studio/src/main.ts` — creates the shared `MaterialPlugin`, resolves the `SceneSource`, installs the showcase before `run()`
- `apps/studio/models/Clover_1.{gltf,bin}`, `apps/studio/models/Leaves.png` — bundled showcase model
- `apps/studio/src/assets.d.ts` — `*.gltf` / `*.bin` / `*.png` module declarations
