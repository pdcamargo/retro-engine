# ADR-0126: Sub-asset references via composite GUID-URIs

- **Status:** Accepted
- **Date:** 2026-06-26

## Context

Container files decode into child assets: a glTF/GLB model yields meshes, materials, and animation clips; a texture yields sprites. The importer already registers these via `LoadContext.addLabeledAsset(label, value, store)` with a stable, deterministic label (`Animation0`, `Material0`, `Mesh0/Primitive1`), and the `Gltf` root exposes the resulting handles.

But these sub-assets had no persistent identity. `addLabeledAsset` reserved a GUID-less runtime handle, while every saved reference in the engine — a scene's `t.handle(...)` field, an `AnimationController` motion, an asset-picker assignment — is a single GUID string resolved through `AssetServer.loadByGuid`, which requires a manifest entry. A sub-asset had neither a GUID nor a manifest entry, so "use this model's Run clip on another character" — the goal ADR-0122 retargeting was built for — had no editor data path: there was no way to name the clip such that the reference survived save and reload.

The static asset scan (ADR-0111) is deliberately IO-free and cannot enumerate a binary's contents; minting per-sub-asset sidecars would also break the one-GUID-per-`.meta` model (ADR-0089).

## Decision

A sub-asset's persistent identity is the **composite GUID-URI** `"<parentGuid>#<label>"`, derived deterministically from its container's GUID and the importer's existing label. Because a v4 UUID never contains `#`, the first `#` splits a reference cleanly, and because the result is a single string it flows through the existing handle-as-GUID serialization with **zero scene-format change**.

- `subAssetGuid(parent, label)` / `parseSubAssetGuid(guid)` (in `@retro-engine/assets`) are the only place the `#` convention is encoded.
- When a load carries a parent GUID, `addLabeledAsset` reserves the sub-handle **with** the composite GUID, so the sub-asset is indexed by GUID in its store on commit.
- `AssetServer.loadByGuid` resolves a composite reference: it reserves the sub-handle synchronously with the deterministic GUID, then loads the parent (idempotent); the parent's `addLabeledAsset` fills that same slot, matched by GUID. Stores register for resolution by label prefix via `registerSubAssetStore(prefix, store)`.
- This pass registers only the `Animation` prefix → `AnimationClips`, making a model's clips assignable to a `Handle<AnimationClip>` field. Meshes and materials are surfaced for display but not yet assignable (a GLB mesh is not a standalone `.rmesh` — a larger semantic call deferred to the backlog).

## Consequences

- A model's animation clip can be assigned (e.g. to `AnimationPlayer.clip`) through the existing asset-picker handle field, and the reference round-trips through scene save/load unchanged.
- Sub-asset resolution is lazy and idempotent: requesting `parent#label` ensures the parent loads once; the synchronously-returned handle resolves when the parent drains.
- The scheme inherits the limitation that labels are stable per file but not across a DCC re-export that reorders animations/meshes — acceptable, and the same class of constraint as engine `fileID`s elsewhere. A name- or hash-based sub-id is possible later.
- Identity is correct without any new persistence; an eager `.meta` sub-asset index (so the browser can list a model's children without loading it) remains a follow-up. The studio enumerates lazily on demand for now.

## Implementation

- `packages/assets/src/asset-id.ts` — `subAssetGuid`, `parseSubAssetGuid`
- `packages/engine/src/asset/asset-server.ts` — `AssetServer.registerSubAssetStore`, sub-ref resolution in `loadByGuid` / `loadSubAsset`, parent-GUID threading through `addLabeledAsset` / `runLoad`, sub-ref-aware `hasGuid`
- `packages/engine/src/animation/animation-plugin.ts` — `registerSubAssetStore('Animation', clips)`
- `apps/studio/src/asset-picker/asset-picker-catalog.ts` — `assetTypeSpec` `'AnimationClip'` case
- `apps/studio/src/project/model-subassets.ts` — `createModelSubAssetService` (lazy enumeration of a model's children into `BrowserAsset.subs`)
