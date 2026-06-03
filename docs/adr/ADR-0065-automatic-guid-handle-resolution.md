# ADR-0065: Automatic GUID handle resolution for scenes

- **Status:** Accepted
- **Date:** 2026-06-03

## Context

ADR-0060 sealed reflection v1: an asset handle serializes by its GUID, a handle with no GUID is omitted, and — crucially — "there is no global GUID→handle resolver, so deserialize requires a caller-injected `resolveHandle`". ADR-0061 and ADR-0064 then registered every engine component but left that resolver consumer-supplied; ADR-0064 booked it as an accepted cost. The result: a saved scene could not actually load without bespoke, per-asset glue at every `spawnScene` call site.

ADR-0055 designed the persistent project tier (manifest, `.meta` GUID sidecars, disk/bundle sources, load-on-demand) and deferred it to a later initiative. This ADR does **not** build that tier. It closes only the **scene-blocking slice**: resolving handles whose assets are already present in their stores at spawn time, with no injected resolver. Tracked by `docs/backlog/asset-guid-handle-resolution.md`. ADR-0055 stays sealed; this extends it.

Two facts shaped the design. Asset stores are plain App resources (`Meshes`, `Images`, `TextureAtlasLayouts`, the per-class `Materials<M>`), inserted order-independently and not held by the `AssetServer` (which needs an `AssetSource` at construction and so cannot be lazily created). And the material handle fields shared a single `'Materials'` / `'Materials2d'` key across every material class, even though each class owns its own store — an ambiguity that had to be resolved before a key could identify a store.

## Decision

- **`Assets<T>` indexes every value by its `AssetGuid`.** `add(value, guid?)` mints a fresh v4 GUID when none is supplied — so every in-memory asset is serializable and resolvable by default — and registers it; an explicit `guid` adopts an existing identity (the future manifest/loader path). `handleByGuid(guid)` routes a GUID back to its live slot. `insert` registers a GUID-bearing handle; `remove` drops it. `reserveHandle` stays GUID-less.
- **A new engine resource `AssetStores` maps each reflection asset-type key to the `Assets` store that owns it.** `registerAssetStore(app, key, store)` populates it (get-or-create, mirroring the existing `if getResource === undefined` idiom) and is called by each store-owning plugin in `build`. `handleFor(assetType, guid)` resolves through the matching store.
- **The asset-type keys are formalized as the single source of truth.** `ASSET_TYPE` constants for the fixed stores (`'Mesh'`, `'Image'`, `'TextureAtlasLayout'`); per-class keys for materials (`Materials<M>` / `Materials2d<M>`) so two material types never resolve to each other's store. This replaces the previously-shared, ambiguous material keys; the same string backs both the `t.handle` schema and the store registration.
- **`spawnScene` builds the default resolver from the App's `AssetStores`** when no `resolveHandle` is injected; an injected resolver still wins (tools/tests). `deserializeScene` (the bare-world, App-less path) keeps its throw. `addScene` / `SceneRoot` / the instantiation reactor route through `spawnScene`, so dropping the resolver there now auto-resolves with no functional change.
- **Missing-GUID policy is to throw.** `handleFor` throws for an unregistered asset type (a wiring gap — the component is registered but its store is not) and for a GUID absent from its store (the asset is not loaded; this slice does not fetch it from disk).

## Consequences

- A scene referencing a mesh, material, sprite texture, or atlas by GUID loads with **no `resolveHandle` passed**, resolving against assets already in their stores. ADR-0064's accepted cost is closed; `spawnScene(app, scene)` is a complete load.
- The default is persistence (CLAUDE.md §13): every `add`'d asset carries a GUID and round-trips. Transient/runtime-only assets also get GUIDs — harmless; they simply serialize when referenced.
- Material handle fields now key on a per-class asset type. The serialized scene stores only the GUID (the asset type comes from the registry's `FieldType` at decode), so existing serialized scenes and the injected-resolver round-trip tests are unaffected.
- Resolution lives in a standalone `AssetStores` resource, not on the `AssetServer`. The assets package stays generic (a per-store GUID index, no knowledge of engine asset-type strings); the engine owns the assetType→store mapping. Order-independent: any store plugin can register without depending on `AssetPlugin`.
- Out of scope, still deferred to ADR-0055 / `roadmap/asset-system.md` phases 4–6: the `.retro-project` format, `.meta` sidecars, manifest-driven load, disk/bundle sources, load-on-demand-by-GUID, cross-process GUID stability, and studio integration. A GUID absent at spawn throws rather than streaming the asset in; when async/streamed loading lands, the policy can revisit a tolerant null-handle path (the renderer already skips unresolved handles).
- No benchmark: `add` / `handleByGuid` are not per-frame and `spawnScene` is one-shot load-time (CLAUDE.md §11).
- Extends ADR-0055/0060/0061/0064; supersedes none.

## Implementation

- `packages/assets/src/assets.ts` — `Assets.add(value, guid?)`, `Assets.handleByGuid`, the `byGuid` index, GUID-aware `insert` / `remove`
- `packages/engine/src/asset/asset-stores.ts` — `ASSET_TYPE`, `AssetStores`, `registerAssetStore`
- `packages/engine/src/scene/spawn.ts` — `spawnScene` default-resolver wiring; `SpawnSceneOptions.resolveHandle` reframed as an override
- `packages/engine/src/mesh/mesh-plugin.ts` — registers `Meshes` under `ASSET_TYPE.mesh`
- `packages/engine/src/image/image-plugin.ts` — registers `Images` under `ASSET_TYPE.image`
- `packages/engine/src/sprite/sprite-plugin.ts` — registers `TextureAtlasLayouts` under `ASSET_TYPE.textureAtlasLayout`
- `packages/engine/src/material/material-plugin.ts` — per-class `Materials<M>` key + store registration
- `packages/engine/src/material2d/material-2d-plugin.ts` — per-class `Materials2d<M>` key + store registration
- `packages/engine/src/scene/scene-root.ts`, `packages/engine/src/scene/scene-state.ts` — `resolveHandle` reframed as an optional override
- `packages/assets/src/assets-guid.test.ts`, `packages/engine/src/asset/asset-stores.test.ts` — unit coverage
- `packages/engine/src/scene/scene-roundtrip-3d-auto.test.ts`, `packages/engine/src/scene/scene-roundtrip-2d-auto.test.ts` — automatic-path round-trip coverage
