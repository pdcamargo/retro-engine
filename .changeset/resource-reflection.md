---
'@retro-engine/engine': minor
---

feat(engine): resource reflection — authored resources round-trip into scenes (ADR-0069)

Closes the "resources-as-reflectable" follow-up ADR-0060 reserved. An App-global resource (a settings singleton with no entity identity) can now declare a reflect schema and survive a saved scene, reusing the component codec exactly.

**New public surface:**

- `App.registerResource(ctor, schema, opts?)` — mirrors `App.registerComponent`, with a mandatory stable `name`. The owning plugin registers from `build()`. The schema lives in the App's one `TypeRegistry`; `AppTypeRegistry.resources` tracks which registered types are resources, so `@retro-engine/reflect` stays agnostic of the resource concept.
- `SceneData.resources?: SerializedValue[]` — optional and additive. `SCENE_FORMAT_VERSION` is unchanged: a scene with no resources round-trips byte-identically, and the key is omitted when no registered resource is present. Resolves the "resource definitions in scene files" question — resources travel with the scene.
- `buildEncodeEnv(world, registry, opts)` — the encode-side mirror of `buildDecodeEnv`, so entities and resources serialize against the same entity-id map (resource `t.entity()` / `t.handle()` fields remap/resolve like a component's).

**Behaviour:**

- `serializeScene(app)` now captures registered resources alongside entities; `spawnScene(app, scene)` restores them via `insertResource`, decoded against the same env. The bare-world `serializeWorld` / `deserializeScene` path stays resource-free.
- Authored world settings register from their owning plugins: `AmbientLight` + `Shadow3dSettings` (Light3dPlugin), `ClearColor` (CameraPlugin), `Light2dSettings` (Light2dPlugin). Derived/transient resources (`Light2dShadowState`, `Light2dNormalState`, `GpuLights`, `Shadow3dState`, `SortedCameras`, `View*` caches, render-graph phase/pipeline/buffer resources, render-world asset caches) are deliberately not registered.
