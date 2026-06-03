---
'@retro-engine/engine': minor
---

feat(engine): scenes as loadable, state-gated assets — Scene asset, ScenePlugin, SceneRoot reactor, App.addScene lifecycle

Per ADR-0062. Turns the ADR-0061 `spawnScene` primitive into a usable scene system: a `Scene` becomes a loadable asset with a load/unload lifecycle gated behind a `States` value.

- **`Scene` asset + `ScenePlugin`** — `class Scene { data: SceneData }`, a `Scenes` store, and a `.scene` JSON importer/serializer (`createSceneImporter` / `createSceneSerializer`) registered by the opt-in `ScenePlugin`. `assetServer.load<Scene>('x.scene')` yields a `Handle<Scene>`.
- **`SceneRoot` reactor** — a `SceneRoot { handle }` component + an `update`-stage reactor that spawns the scene under the root once the asset is ready and records a `SceneInstance`, mirroring the glTF instantiation precedent (ADR-0057). The scene's top-level entities are re-parented under the `SceneRoot` entity, so despawning the root tears the whole instance down via the hierarchy cascade.
- **`App.addScene(state, handle, opts?)`** — binds a scene to a `States` value: spawns on `OnEnter(state)`, despawns on `OnExit(state)`. Teardown order is user `OnExit` → scene despawn → state-scoped resource removal.

Handle resolution stays caller-injected (no automatic GUID→handle resolver yet). Prefab templates/patches, scene composition, inline observer binding, hot-reload, the GUID tier, and registering the remaining components stay deferred.

No benchmark: scene load (`JSON.parse` + `spawnScene`) and unload (cascade despawn) are one-shot load-time operations; the per-frame propagation they trigger is already benched (CLAUDE.md §11).
