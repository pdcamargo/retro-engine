# Persist glTF instances in scenes (reflect-register GltfSceneRoot)

- **Created:** 2026-06-16

## Context

`GltfSceneRoot` (the component that makes the reactor instantiate a glTF node
graph under an entity) has no reflection schema, so a glTF model instance cannot
be authored into a `SceneData` — it must be spawned programmatically. The studio
showcase (ADR-0080) works around this by spawning the glTF root in code alongside
the loaded scene. A real editor will want to drop a model into a scene and have
that instance survive a save/load.

## Why deferred

It is its own decision with real questions: `GltfSceneRoot` holds a `Handle<Gltf>`,
so persisting it needs the glTF asset to have a stable GUID resolvable on load
(via ADR-0065 automatic resolution or an ADR-0066 manifest), and a schema with
`t.handle('Gltf')`. That is engine/asset work distinct from the editor-side bridge,
and the programmatic path is sufficient to prove the editor reads model hierarchies.

## Acceptance

- `GltfSceneRoot` has a reflection schema registered by its owning plugin (or is
  deliberately classified otherwise via an ADR), so a scene that references a glTF
  asset by GUID round-trips through `serializeScene` → `spawnScene` and
  re-instantiates the node graph on load.
- The studio showcase (or a successor) loads its glTF instance through the scene
  rather than a separate programmatic spawn.
