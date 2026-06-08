# Scenes and Prefabs

- **Created:** 2026-05-21
- **Status:** Active — phase 1 + the load/unload lifecycle (ADR-0062), templates/patches (ADR-0067), and inline observer binding (ADR-0068) shipped. Later phases (composition, hot-reload, studio) remain sketches.

## Goal

A TypeScript-native scene + prefab system, designed for our archetype World and our (forthcoming) reflection model. Scenes are loadable assets that bring up a curated entity graph, optionally register systems, and insert state-scoped resources — all gated behind a `States` value so loading and tearing down a scene is just a state transition. Prefabs are reusable entity templates spawnable as full new entities or as **patches** applied to existing ones.

This is **our** system. Bevy's BSN (Bevy Scene Notation, PR #20158, in flight as of early 2026) is the right *shape* — entity templates, patch-based application, observer binding inline in the scene definition — and we borrow those ideas. We don't wait on the BSN PR landing in Bevy 0.18; we design for our reflection system and ship when the prerequisites (M2 foundations + reflection + asset handles) are in place.

We're done when: a scene file (format TBD) can be loaded as an asset, its entities spawned into the world on `OnEnter(SceneId)`, its observers bound, and the whole graph cleanly torn down on `OnExit(SceneId)`. Hot-reload re-spawns the scene with diff-based updates where possible.

## Phases

Each phase is a sketch. Promote when prerequisites land and a real consumer asks for it.

1. **Scene-as-asset format** — **Shipped (ADR-0062).** JSON `.scene` files load through the `AssetServer` into an `Assets<Scene>` store (`ScenePlugin`); driven by reflection — components declare their schema, the format references types by registered name. The whole lifecycle landed with it: `SceneRoot` + a reactor instantiate the graph once ready, and `App.addScene(state, handle)` gates spawn/teardown behind a `States` value. A custom DSL stays deferred (JSON-first lean below).
2. **Entity templates with named parameters** — **Shipped (ADR-0067).** `defineTemplate({ name, params, build })` defines a prototype entity graph (`Player` = `[Transform, Sprite('player.png'), Health(100)]`); `spawnTemplate(app, Player, { position, health: 200 })` substitutes typed params (with `.default()`s) at spawn time.
3. **Entity patches** — **Shipped (ADR-0067).** `applyTemplate(app, entity, template, params?)` applies a template to an existing entity rather than spawning fresh — "add the Damaged state visuals" without rebuilding it (insert overwrites a present component, adds a missing one). BSN's core idea, adapted; overrides are one-shot.
4. **Spawn integration with Required Components** — **Shipped (ADR-0067).** Template spawn rides the command buffer → `resolveBundle`, so the definition lists the explicit components and transitive `static requires` fill in (explicit template components win).
5. **Inline observer binding** — **Shipped (ADR-0068).** A scene attaches entity-targeted observers to its entities by referencing registered handler names (`observers: [{ handler: 'onClick' }]`). A handler — registered in code via `app.registerObserverHandler(defineObserverHandler({ name, event, params, run }))` — bundles the event it observes and the body to run, so the scene stays pure data. Built on the observer *runtime* (ADR-0013, already shipped); only the serializable binding layer landed here.
6. **Scene composition** — a parent scene includes other scenes as nested entities. Lets you build levels by stitching together rooms / encounters / NPCs without duplicating definitions.
7. **Hot reload** — when a `.scene` file changes during dev, the runtime re-applies it to the live world, diff-based where reflection metadata makes it safe. Worst case: re-trigger `OnExit(SceneId)` → `OnEnter(SceneId)`.
8. **Studio integration** — scene saver / loader in the studio, scene tree inspector, drag-drop entity into scene, observer binding UI. Far-future; on the studio side, not the engine side.

## Open questions

- **Format choice.** JSON is the path of least resistance and works with any editor. A custom `.scene` DSL is more readable for hand-authored scenes (BSN's pitch). We can do both — JSON canonical, DSL as syntactic sugar that desugars to JSON — but adding a custom parser is real work. Default lean: JSON first, DSL later if hand-authoring becomes painful.
- **Relationship to GUID asset handles.** **Resolved (ADR-0065).** Scenes reference assets by GUID, and `spawnScene` restores those handles automatically through the App's `AssetStores` — no caller-injected `resolveHandle`, for assets already in their stores. Disk/manifest load-on-demand stays in `asset-system.md` phases 4–6.
- **Teardown ordering on `OnExit(SceneId)`.** **Locked (ADR-0062): user `OnExit` → scene despawn → state-scoped resource removal.** Realized through `OnExit` registration order — the scene despawn is registered by `App.addScene`, so `OnExit` systems registered before that call run before the despawn (and can read the live scene one last time); the state machine removes scoped resources afterwards. Explicit `OnExit` ordering (independent of registration order) is deferred.
- **Resource definitions in scene files.** **Resolved (ADR-0069): yes — inline.** A scene carries its registered resources in the additive `SceneData.resources` (`SCENE_FORMAT_VERSION` unchanged). The resource type must be reflection-registered via `App.registerResource`; `serializeScene` captures the App's registered resources, and `spawnScene` restores them via `insertResource`. Binding restored resources into the `OnExit` state-scoped removal is a follow-up.
- **Observer serialization.** **Resolved (ADR-0068): handlers are registered by name; the scene references the name only.** Serializing the *binding* is easy; serializing the *handler* is impossible — it's code. So `app.registerObserverHandler(defineObserverHandler({ name, event, params, run }))` bundles the event + params + body under a stable name, and `SerializedEntity.observers` lists `{ handler }` bindings, resolved and attached at spawn through the same `commands.entity(e).observe` path (so teardown via `clearTargetedFor` is automatic). Like Unity's UnityEvents (serialize the method name, resolve at load). Entity-targeted only; global observers stay app code.
- **Prefab override semantics.** **Locked (ADR-0067): one-shot, in two layers.** A spawn call or scene ref substitutes typed `params`; a scene ref may additionally carry field-level `overrides` overlaid onto the produced components. All overrides apply at spawn and are not tracked afterward — serialization re-emits the expanded components, not the template ref. A persistent / live prefab link (which fields are template-default vs instance-override) is a future ADR with a provenance component if an editor consumer needs it.
- **What's the relationship between scenes and `States`?** **Locked (ADR-0062): a scene is an abstraction *on top of* States, not identical to them.** `App.addScene(stateValue, handle)` binds a scene to a `States` value; the transition drives spawn (`OnEnter`) and teardown (`OnExit`). A scene is referenced by a state value rather than *being* one, so a state can carry a scene and other behavior, and an entity-level `SceneRoot` can spawn a scene with no state at all.

## Relationship to glTF instantiation

glTF import (ADR-0057, `docs/roadmap/gltf.md`) ships the **first concrete prefab-instantiation** before
this full system exists: a `GltfSceneRoot` reactor spawns a glTF node graph as a named entity tree
(each node an entity with `Transform` + the `Name` component, parent/child wired, mesh nodes carrying
`Mesh3d`+`MeshMaterial3d`) and records a node-name→entity lookup. This is deliberately
forward-compatible — the **`Name` component is introduced there and shared here**, and when this system
lands a glTF scene becomes a prefab **source** consumed through the same instantiation model, not a
parallel mechanism. glTF is not blocked on this initiative.

## Inspiration, not dependency

Bevy BSN's design ideas worth borrowing:
- **Templates produce entity patches**, not just spawn instructions. A template is "apply these components / values," whether to a fresh entity or an existing one.
- **Observer binding inline in scene definition** — scene files describe behavior bindings, not just data.
- **Reflection-driven serialization** — components declare schema once, scene format references types by registered name.
- **Composition over inheritance** — scenes include other scenes; templates compose other templates; no class hierarchy.

What we do not borrow:
- Bevy's RON format — JSON or a custom DSL fits TS better.
- Bevy's reflection macros — we use decorators or registration calls; covered in `reflection-and-serialization.md`.
- Anything that assumes a Rust borrow checker — observer handlers, patch application, hot-reload all need TS-shaped lifecycle stories.

## Links

- Foundation: `docs/roadmap/engine-foundations.md` (M2 — Required Components + `States` + `Commands` + Plugin lifecycle all participate)
- Prereq: `docs/roadmap/reflection-and-serialization.md`
- Prereq: `docs/roadmap/asset-system.md` (handle shape, project format)
- Built on: `docs/roadmap/observers-and-events.md` — the observer *runtime* shipped (ADR-0013); inline observer binding (ADR-0068) is the serialization layer on top.
- Related: `docs/roadmap/gltf.md` (glTF instantiation is the first prefab-instantiation; introduces the shared `Name` component — ADR-0057)
- Consumer: `docs/roadmap/ui-system.md` (UI screens are scenes)
- Consumer: `docs/roadmap/studio-imgui.md` (studio's scene editor needs save/load + hot-reload hooks)
- ADR-0001 (composition-only — no `Scene` base class; scenes are data that drives the World)
- External inspiration:
  - Bevy BSN ([PR #20158](https://github.com/bevyengine/bevy/pull/20158))
  - Bevy `DynamicScene` + `SceneSpawner` ([bevy-cheatbook: scenes](https://bevy-cheatbook.github.io/features/scenes.html))
  - This Week in Bevy: BSN public experimentation ([2025-07-21](https://thisweekinbevy.com/issue/2025-07-21-bsn-public-experimentation-streaming-video-and-compute-shaders))
