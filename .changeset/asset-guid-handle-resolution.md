---
'@retro-engine/assets': minor
'@retro-engine/engine': minor
---

feat(engine): automatic GUID handle resolution for scenes

Per ADR-0065, a saved scene now restores its asset handles by GUID with **no caller-injected `resolveHandle`**. `spawnScene(app, scene)` resolves a referenced mesh, material, sprite texture, or atlas against the assets already in their stores — closing the resolver-injection cost ADR-0064 had accepted. This is the scene-blocking slice of the persistent asset tier; the manifest, `.meta` sidecars, disk/bundle sources, and load-on-demand-by-GUID (ADR-0055 phases 4–6) remain out of scope.

**`@retro-engine/assets`:**

- `Assets<T>` now indexes every value by its `AssetGuid`. `add(value, guid?)` mints a fresh v4 GUID when none is supplied — so every in-memory asset is serializable and resolvable by default — or adopts an explicit one (the manifest/loader path).
- `Assets.handleByGuid(guid)` resolves a persistent GUID back to its live store slot. `insert` indexes a GUID-bearing handle; `remove` drops it. `reserveHandle` stays GUID-less.

**`@retro-engine/engine`:**

- New `AssetStores` resource maps each reflection asset-type key to its owning `Assets` store; `registerAssetStore(app, key, store)` populates it from a store-owning plugin's `build`. `ASSET_TYPE` exposes the fixed-store keys (`'Mesh'`, `'Image'`, `'TextureAtlasLayout'`).
- `spawnScene` builds the default resolver from the App's `AssetStores` when no `resolveHandle` is passed; an injected resolver still overrides. A referenced GUID absent from its store throws.
- Material handle fields now key on a **per-class** asset type (`Materials<M>` / `Materials2d<M>`) instead of the previously-ambiguous shared `'Materials'` / `'Materials2d'`. The serialized scene stores only the GUID, so existing scenes are unaffected.
