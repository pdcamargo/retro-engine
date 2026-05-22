# Asset System

- **Created:** 2026-05-21
- **Status:** Planning

## Goal

`packages/assets` provides a GUID-based asset system. Assets are referenced by stable IDs, never by path. Project save/load round-trips assets, scenes, and references intact. Importers and serializers register against a central registry; new asset types are added by registration, not by inheritance.

## Phases

1. **Asset ID and handle types** — opaque GUID, `Handle<T>` with type-level discrimination.
2. **Asset store** — runtime map ID → loaded asset; ref-counted for unload.
3. **Importer registry** — strategy pattern; each file extension or asset kind registers an importer function `(bytes) => Asset`. Hot-reload friendly.
4. **Serializer registry** — symmetric to importers for save.
5. **Project format** — directory layout for `.retro-project`, manifest file, asset metadata. JSON or binary? Probably JSON for v1; binary later if perf demands.
6. **Reference resolution** — handles in serialized data reference assets by GUID; loader resolves to in-memory handles.
7. **Studio integration** — asset browser, drag-drop into scene, rename without breaking references.

(Scene system moved to its own roadmap: `docs/roadmap/scenes-and-prefabs.md`.)

## Open questions

- GUID generation: random v4 vs content-addressed hash? Hash is reproducible but rename detection breaks.
- Handle lifecycle: ref-counted with manual release, or rely on GC? GC means we can't predict unload timing.
- Async loading model: promises, observable handles, or schedule-bound `AssetLoad` system?
- Editor vs runtime asset paths: do we ship an asset bundle at runtime, or always resolve from a manifest?

## Links

- Unity's AssetDatabase (reference for the studio-side)
- Bevy's `AssetServer` (reference for runtime API)
