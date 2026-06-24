---
'@retro-engine/engine': minor
'@retro-engine/gltf': minor
---

feat(engine): asset-kind registry + on-discovery `.meta` sidecar generation

Per ADR-0111. `.meta` sidecars are the source of truth for asset identity, but they were only ever written by a project save — so a loose asset dropped into a project (a `.glb`, an image) never gained a GUID, never entered the manifest, and never appeared in the studio asset browser. This adds the discovery half: a central catalog of asset kinds plus a pure pass that mints sidecars for loose source assets.

**New public surface:**

- `AssetKinds` — main-world resource cataloguing every asset kind; `registerAssetKind(app, descriptor)` registers one in a plugin's `build()`.
- `AssetKindDescriptor` — declares a kind's tag, claimed `extensions`, whether it is `discoverable` (loose files get a sidecar minted), an optional `largeBinary` hint, a UI `category` string, and an optional `defaultMeta()` factory for the sidecar `data` body.
- `generateMissingSidecars(files, kinds)` — pure, idempotent function returning the `.meta` writes for loose discoverable assets lacking a sibling sidecar (no I/O; callers write through an `AssetSink`). `GenerateSidecarsResult`, `MintedSidecar`.
- `AssetMetaFile.data` (+ `AssetMetaData`, `bakeMetaWithData`, `parseMeta`) — optional additive per-kind metadata body on the sidecar (wire version stays 1).
- `@retro-engine/gltf`: `GLTF_ASSET_KIND`, `gltfAssetKindDescriptor` — the glTF/GLB kind descriptor (discoverable, `model` category), registered by `GltfPlugin`.

**Behaviour:**

- The engine's built-in kind-owning plugins (image, mesh, scene, bundle, sprite, material) now register an `AssetKindDescriptor`. Images and glTF are discoverable; engine-authored outputs (`.rmesh`/`.rescene`/`.rebundle`/`.remat`) are catalogued but not discovered.
- No change to the save path or manifest scan; `data` is additive and `scanMetaManifest` is untouched.
