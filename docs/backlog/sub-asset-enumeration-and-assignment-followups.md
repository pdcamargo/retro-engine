# Sub-asset enumeration & assignment follow-ups

Deferred work from the Assets Panel rewrite + sub-asset reference scheme ([ADR-0126](../adr/ADR-0126-sub-asset-references-via-composite-guid-uris.md)). The composite GUID-URI (`parentGuid#label`) and lazy model enumeration shipped; these extend it.

## Eager `.meta` sub-asset index

Today the studio enumerates a model's children lazily (load-on-expand via `createModelSubAssetService`), so search and the type filter only see children of models that have already loaded. Persist a sub-asset index into the `.glb.meta` `data` body (ADR-0111) on first successful load — `{ subs: { label, kind, name }[] }` — so the browser can list a model's children without touching the binary, and search/filter work across the whole library immediately. Mirrors the deferred lazy-thumbnail caching.

## Mesh / material assignment from a model

A model's meshes and materials are **displayed** in the derived-asset drawer but are not assignable to `Handle<Mesh>` / material slots. A GLB mesh is not a standalone `.rmesh`, so exposing in-GLB meshes as assignable `Mesh` candidates is a semantic decision (instantiate-as-hierarchy vs assign-single-mesh). Decide and, if assigning, register the `Mesh` / material prefixes with `registerSubAssetStore` and extend `assetTypeSpec`. Animations are assignable today; these are not.

## Label stability across DCC re-export

Sub-asset GUID-URIs use the importer's positional label (`Animation0`). Re-exporting a model from the DCC tool with reordered animations/meshes shifts labels, breaking saved references. Consider a name-based or content-hashed sub-id with a migration path. Same class of constraint as engine `fileID`s; low priority until it bites.

## FBX scan-time enumeration

There is no in-repo TypeScript FBX parser (only the `fbx-to-glb` Blender skill), so a loose `.fbx` cannot be enumerated at scan time or in browser builds. Rely on converting FBX → GLB before import (the GLB carries the sub-assets). Revisit only if loose-FBX browsing becomes a real need.

## Graph-aware hot reload of sub-assets

Hot reload (ADR-0102) does not yet re-resolve sub-asset handles behind a stable reference when a container reloads. Already noted as deferred in ADR-0056's consequences; track here against the new GUID-URI scheme.
