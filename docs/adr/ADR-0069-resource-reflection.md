# ADR-0069: Resource reflection

- **Status:** Accepted
- **Date:** 2026-06-08

## Context

ADR-0060 shipped reflection + serialization and explicitly deferred
"resources-as-reflectable". ADR-0061 reflected engine components and gave the App a
`TypeRegistry` (the `AppTypeRegistry` resource); ADR-0064 drove every authored
*component* to be registered or classified. Resources were left out: there was no
mechanism to reflect an App-global singleton (a `ResMut`-driven settings object with
no entity identity), so authored world/render settings could not survive a saved
scene. That gap blocks the project-save tier (ADR-0070) — a reloaded scene would
restore entities but snap world settings back to their plugin defaults.

The `docs/backlog/engine-component-registration-coverage.md` item (rescoped to
resources) named the candidates: `AmbientLight`, `Shadow3dSettings`, `ClearColor`,
`Light2dSettings`, and — incorrectly — `Light2dShadowState` / `Light2dNormalState`.
Inspection shows the latter two hold GPU handles, scratch buffers, and per-frame
counters: they are derived/transient, not authored. This ADR corrects that record
(the backlog is editable; sealed ADRs are not). Resources must reuse the component
codec exactly — the only new thing is *where* a resource is pulled from and *where*
its data lands.

## Decision

- **Resource schemas live in the same per-App `TypeRegistry`; resource *membership*
  is tracked engine-side.** A resource registers through `registerType` (so the
  reflect codec resolves it by name like any value type) with `attachable: false`,
  and the `AppTypeRegistry` gains a `resources: Map<ctor, RegisteredType>` recording
  which registered types are resources. `@retro-engine/reflect` stays agnostic of the
  "resource" concept (it has no `App`/singleton notion); a `kind` enum in `reflect`
  would leak an engine concept for zero codec benefit.
- **`App.registerResource(ctor, schema, { name })`** mirrors `App.registerComponent`:
  a mandatory stable `name` (class names are minification-unsafe), duplicate-name
  policy inherited from `TypeRegistry` (same name + different ctor throws).
- **Serialized resources live in the scene envelope.** `SceneData` gains an optional,
  additive `resources?: SerializedValue[]`. `SCENE_FORMAT_VERSION` stays `1`:
  additive + optional means an existing scene (no key) round-trips byte-identically,
  and `serializeScene` omits the key entirely when no registered resource is present.
  This resolves the `scenes-and-prefabs.md` "Resource definitions in scene files" open
  question — **yes, resources travel with the scene**, matching ADR-0062's
  state-scoped resource lifecycle.
- **One env for entities and resources.** `serializeScene` builds the `EncodeEnv`
  (and the compact entity-id map) once via the extracted `buildEncodeEnv`, then
  encodes both entities and registered resources against it, so a resource's
  `t.entity()` / `t.handle()` field remaps/resolves identically to a component's.
  `spawnScene` restores resources via `App.insertResource`, decoded against the same
  `DecodeEnv` it uses for entities. The bare-world `serializeWorld` / `deserializeScene`
  path has no App, so it stays resource-free.
- **v1 restores globally.** Restored resources are inserted on the App; wiring them
  into ADR-0062's state-scoped `OnExit` removal is deferred (`spawnScene` has no state
  context).
- **Classification (CLAUDE.md §13).** Registered: `AmbientLight`, `Shadow3dSettings`,
  `ClearColor`, `Light2dSettings`. Deliberately **not** serialized (derived/transient):
  `Light2dShadowState`, `Light2dNormalState`, `GpuLights`, `Shadow3dState`,
  `SortedCameras`, the `View*` render-target/cache resources, render-graph
  phase/pipeline/instance-buffer resources, `RenderMeshes` / `RenderImages` /
  `RenderMaterials*`, and the `TextureAtlasLayouts` store — each rebuilt from authored
  state or GPU context at startup/extract, never authored.

## Consequences

- A saved scene now restores its world settings; ADR-0070's project save builds on
  this. The resource round-trip test proves fields, `.skip()` reversion, entity-ref
  remapping, and asset-handle resolution all match the component path.
- `@retro-engine/reflect` is untouched — no reflect changeset; the resource concept
  stays where resources live (the engine).
- `serializeScene` of a default App now emits a `resources` key, because `ClearColor`
  is always registered (CameraPlugin) and present. This is intended — authored world
  settings travel with the scene; existing parse/spawn tolerate the key, and the bare
  `serializeWorld` output is unchanged.
- Restoring a resource a plugin already default-inserted replaces it and emits a
  `devWarn` (scene wins). Acceptable; a silent-replace variant is possible polish.
- No benchmark: resource (de)serialization is one-shot at load, off the per-frame path
  (CLAUDE.md §11).

## Implementation

- `packages/engine/src/index.ts` — `App.registerResource`
- `packages/engine/src/scene/app-type-registry.ts` — `AppTypeRegistry.resources`
- `packages/engine/src/scene/serialize.ts` — `buildEncodeEnv`, resource-aware `serializeScene`
- `packages/engine/src/scene/scene-data.ts` — `SceneData.resources`
- `packages/engine/src/scene/scene-importer.ts` — `validateSceneData` tolerates `resources`
- `packages/engine/src/scene/spawn.ts` — resource restore in `spawnScene`
- `packages/engine/src/light3d/light-3d-plugin.ts` — registers `AmbientLight`, `Shadow3dSettings`
- `packages/engine/src/camera/camera-plugin.ts` — registers `ClearColor`
- `packages/engine/src/light2d/light-2d-plugin.ts` — registers `Light2dSettings`
- `packages/engine/src/scene/resource-roundtrip.test.ts` — round-trip + classification coverage
