# Scenes and Prefabs

- **Created:** 2026-05-21
- **Status:** Future direction (designed in-house — not waiting on upstream)

## Goal

A TypeScript-native scene + prefab system, designed for our archetype World and our (forthcoming) reflection model. Scenes are loadable assets that bring up a curated entity graph, optionally register systems, and insert state-scoped resources — all gated behind a `States` value so loading and tearing down a scene is just a state transition. Prefabs are reusable entity templates spawnable as full new entities or as **patches** applied to existing ones.

This is **our** system. Bevy's BSN (Bevy Scene Notation, PR #20158, in flight as of early 2026) is the right *shape* — entity templates, patch-based application, observer binding inline in the scene definition — and we borrow those ideas. We don't wait on the BSN PR landing in Bevy 0.18; we design for our reflection system and ship when the prerequisites (M2 foundations + reflection + asset handles) are in place.

We're done when: a scene file (format TBD) can be loaded as an asset, its entities spawned into the world on `OnEnter(SceneId)`, its observers bound, and the whole graph cleanly torn down on `OnExit(SceneId)`. Hot-reload re-spawns the scene with diff-based updates where possible.

## Phases

Each phase is a sketch. Promote when prerequisites land and a real consumer asks for it.

1. **Scene-as-asset format** — JSON, custom DSL (`.scene` files with a hand-rolled parser), or both. Driven by reflection: every serializable component declares its schema, the format references types by registered name. **Open** — see below.
2. **Entity templates with named parameters** — a template defines a prototype entity graph (`Player` template = `[Transform, Sprite('player.png'), Health(100)]`). Parameters substitute at spawn time (`spawn(Player, { position: ..., health: 200 })`).
3. **Entity patches** — apply a template to an existing entity rather than spawning fresh. Lets you "add the Damaged state visuals" to an existing entity without rebuilding it. BSN's core idea, adapted.
4. **Spawn integration with Required Components** — spawning a template uses the M2 Required Components mechanism. Scene/prefab definitions list the explicit components; required dependencies fill in.
5. **Inline observer binding** — a scene definition can attach observers to its entities (`onClick`, `onDamage`, …) without round-tripping through code. Requires the observer system from `observers-and-events.md`.
6. **Scene composition** — a parent scene includes other scenes as nested entities. Lets you build levels by stitching together rooms / encounters / NPCs without duplicating definitions.
7. **Hot reload** — when a `.scene` file changes during dev, the runtime re-applies it to the live world, diff-based where reflection metadata makes it safe. Worst case: re-trigger `OnExit(SceneId)` → `OnEnter(SceneId)`.
8. **Studio integration** — scene saver / loader in the studio, scene tree inspector, drag-drop entity into scene, observer binding UI. Far-future; on the studio side, not the engine side.

## Open questions

- **Format choice.** JSON is the path of least resistance and works with any editor. A custom `.scene` DSL is more readable for hand-authored scenes (BSN's pitch). We can do both — JSON canonical, DSL as syntactic sugar that desugars to JSON — but adding a custom parser is real work. Default lean: JSON first, DSL later if hand-authoring becomes painful.
- **Relationship to GUID asset handles.** Scenes reference other assets (textures, audio, child scenes) by handle. Decided as part of `asset-system.md`; scenes adopt whatever handle shape it picks.
- **Teardown ordering on `OnExit(SceneId)`.** Despawn entities first, then remove state-scoped resources, then run user `OnExit` systems? Or user systems first so they can read the world one last time? Recommended default: user `OnExit` → despawn → resource removal. Lock at execution.
- **Resource definitions in scene files.** Should a scene declare its state-scoped resources inline (e.g., `resources: { GameMode: Survival }`), or only entities? Probably yes — but then the resource type must be reflection-registered. Decide once reflection lands.
- **Observer serialization.** Serializing the *binding* (which observer is attached to which event on which entity) is easy. Serializing the *handler* is hard — the handler is code. Default: handlers are registered by name (`onClick: 'showDialog'`), the registry maps name → function, the scene file references names only. Like Unity's UnityEvents.
- **Prefab override semantics.** When a prefab is spawned with parameter overrides, do the overrides persist on the entity, or are they "one-shot at spawn"? Bevy BSN's answer is one-shot. We probably do the same; if not, we need to track which fields are template-default vs instance-override.
- **What's the relationship between scenes and `States`?** Recommended default: a scene is identified by a `States` value (`enum SceneId { MainMenu, Level1, Level2 }`) and `States` transitions drive scene loads. Whether scenes are *exactly* states, or scenes are an additional abstraction on top, is locked at execution.

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
- Prereq: `docs/roadmap/observers-and-events.md` (inline observer binding needs the observer system)
- Related: `docs/roadmap/gltf.md` (glTF instantiation is the first prefab-instantiation; introduces the shared `Name` component — ADR-0057)
- Consumer: `docs/roadmap/ui-system.md` (UI screens are scenes)
- Consumer: `docs/roadmap/studio-imgui.md` (studio's scene editor needs save/load + hot-reload hooks)
- ADR-0001 (composition-only — no `Scene` base class; scenes are data that drives the World)
- External inspiration:
  - Bevy BSN ([PR #20158](https://github.com/bevyengine/bevy/pull/20158))
  - Bevy `DynamicScene` + `SceneSpawner` ([bevy-cheatbook: scenes](https://bevy-cheatbook.github.io/features/scenes.html))
  - This Week in Bevy: BSN public experimentation ([2025-07-21](https://thisweekinbevy.com/issue/2025-07-21-bsn-public-experimentation-streaming-video-and-compute-shaders))
