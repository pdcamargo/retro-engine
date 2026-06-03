# ADR-0062: Scenes as loadable, state-gated assets

- **Status:** Accepted
- **Date:** 2026-06-03

## Context

ADR-0060 (reflection) and ADR-0061 (hook-firing `spawnScene`) shipped the *spawn primitive* — a per-App `AppTypeRegistry`, `serializeWorld`/`serializeScene`, the bare-`World` `deserializeScene`, and the command-driven `spawnScene` that rebuilds hierarchy from the `Parent` edge. But a scene was not yet a thing you could *use*: it was not an asset, there was no load/unload lifecycle, and `spawnScene` was a manual call. ADR-0061 explicitly deferred "the Scene asset type + States-gated load/unload". This ADR builds that — phase 1 of `scenes-and-prefabs.md` plus the lifecycle. It does not change ADR-0060/0061, which stay sealed.

The instantiation precedent already exists in-repo: glTF import (ADR-0057) is a root component + a reactor that spawns a node graph when the asset is ready + an instance record for teardown. A scene is the same shape, so the design mirrors it rather than inventing a parallel mechanism.

Research (verified, not assumed):

- **Bevy `DynamicSceneRoot`** is the ergonomic scene-spawn path: a component on an entity; the `scene_spawner` system instantiates the scene's entities **as children of that entity**, and tearing the instance down is despawning that root. The low-level `SceneSpawner` resource (`spawn_dynamic` → `InstanceId`, `despawn_instance(id)`) is a separate, imperative layer for batched async management.
- **Bevy `DespawnOnExit<S>`** (formerly `StateScoped`) despawns state-scoped entities on state exit and is documented to be used **only on top-level parents** — despawn the root, let the hierarchy cascade, do not double-despawn the children.
- **This engine's glTF reactor** (`gltf-instantiate.ts`) polls the store each `update` frame (store-presence; there is no asset-ready event), spawns the graph under the root via `withChildren`, and records an instance marker to drop the root from the pending query — the exact pattern to mirror.
- **`spawnScene` flushes its command buffer internally**, and `App.flushCommands` during a live `Query` iteration is undefined behavior — so a reactor that calls `spawnScene` must snapshot its ready roots before spawning any of them.
- **The States machine** runs `OnExit` systems in registration order with per-system command flush, then removes state-scoped resources; it has no intra-phase `before`/`after` ordering.

## Decision

- **A `Scene` is an asset.** `class Scene { readonly data: SceneData }` wraps the ADR-0060 envelope; `class Scenes extends Assets<Scene>` is its store. A `.scene` file is UTF-8 JSON validated against `SCENE_FORMAT_VERSION`. An opt-in `ScenePlugin` registers the importer/serializer on the `AssetServer` and installs the reactor, so `assetServer.load<Scene>('x.scene')` yields a `Handle<Scene>`. JSON is the format (the roadmap's "JSON first" lean); a DSL stays deferred.
- **The `SceneRoot` entity *is* the instance** — the glTF/`DynamicSceneRoot` mirror, not a `SceneSpawner` resource. A `SceneRoot { handle, resolveHandle? }` component marks an entity; an `update`-stage reactor snapshots ready roots, runs `spawnScene`, re-parents the scene's top-level (parent-less) entities under the `SceneRoot` entity, and records a `SceneInstance { entities }`. A separate `InstanceId` registry was rejected as a parallel mechanism: the entity id already identifies the instance, and the imperative path is just `cmd.spawn(SceneRoot)` / `cmd.entity(root).despawn()`.
- **Teardown re-parents under the root and despawns it.** Scene content becomes children of the `SceneRoot` entity (which carries a `Transform`), so a single despawn cascades through the `Children` hook — the `DespawnOnExit` "top-level parents only" discipline. The accepted cost is a synthetic transform layer above the scene's authored roots (their `GlobalTransform` becomes relative to the root; an identity root means no visual change).
- **`App.addScene(state, handle, opts?)` binds a scene to a `States` value**, delegating to `registerSceneState` (the `registerOnExit` pattern): `OnEnter(state)` spawns the `SceneRoot` and records it in a `SceneStateRoots` map; `OnExit(state)` despawns it. The locked teardown order is **user `OnExit` → scene despawn → state-scoped resource removal**, realized through `OnExit` registration order — `OnExit` systems registered before the `addScene` call run before the despawn. Explicit `OnExit` ordering is deferred. The scenes↔States relationship is locked: a scene is bound to a state value via `addScene`, an abstraction *on top of* States, not identical to them.
- **Handle resolution stays caller-injected.** The reactor threads an optional `resolveHandle` (from `SceneRoot`/`addScene`); a scene with no handle fields needs none. There is no global GUID→handle resolver in this slice — that tier stays deferred.
- **`SceneRoot` and `SceneInstance` are deliberately not serialized** (CLAUDE.md §13): transient runtime load markers with no persistent identity, the `GltfSceneRoot`/`GltfInstanceNodes` analog.

## Consequences

- A scene loads as an asset (`.scene` file or in-memory `Scene`), spawns on a state transition in, renders, and tears down on transition out with zero leaked entities — driven by a single `app.addScene(state, handle)`.
- Opt-in: an App that never adds `ScenePlugin` pays nothing. `ScenePlugin` requires `AssetPlugin`; `addScene` requires `initState` for the state type.
- The `SceneRoot`-entity-as-instance model means the imperative spawn/despawn API is the ECS itself (spawn a `SceneRoot`, despawn it) — no second instance-tracking surface to learn or keep consistent. Re-parenting under the root changes the live top-level structure versus the serialized shape; this is the same trade-off glTF already makes.
- The teardown-order guarantee is registration-order-based, not a hard scheduler constraint; a future ADR can add explicit `OnExit` ordering if a consumer needs user systems to run after the despawn.
- Deferred, not built here: prefab templates/patches, inline observer binding, scene composition, hot-reload, the automatic GUID→handle resolver, studio integration, registering the remaining components (camera/lights/2D), and explicit `OnExit` ordering. The demo scene is content-only under a persistent camera, so this slice adds no new component registration.
- No benchmark: scene load (`JSON.parse` + `spawnScene`) and unload (cascade despawn) are one-shot load-time operations, not per-frame or content-cost-scaling; the per-frame propagation they trigger is already benched (CLAUDE.md §11).

## Implementation

- `packages/engine/src/scene/scene-asset.ts` — `Scene`, `Scenes`
- `packages/engine/src/scene/scene-importer.ts` — `createSceneImporter`, `createSceneSerializer`
- `packages/engine/src/scene/scene-root.ts` — `SceneRoot`, `SceneInstance`
- `packages/engine/src/scene/scene-reactor.ts` — `addSceneInstantiation`
- `packages/engine/src/scene/scene-state.ts` — `registerSceneState`, `SceneStateRoots`, `AddSceneOptions`
- `packages/engine/src/scene/scene-plugin.ts` — `ScenePlugin`
- `packages/engine/src/index.ts` — `App.addScene` and the scene re-exports
- Builds on ADR-0061 (`spawnScene`, `AppTypeRegistry`) and ADR-0057 (the glTF instantiation precedent)
- Deliberately not registered (transient load markers): `SceneRoot`, `SceneInstance`
