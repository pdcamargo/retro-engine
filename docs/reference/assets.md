# Assets — current state

Covers `packages/assets`, the asset server + kind registry + scene/save concerns of `packages/engine`,
and `packages/gltf`.

**Shape to know up front:** the asset system is mature and well-factored — dual identity
(`AssetIndex` for the hot path, `AssetGuid` for persistence), a sync-handle-now/load-off-schedule
server, a per-plugin kind registry with `.meta` sidecar minting, GUID-keyed loading, sub-asset
composite GUIDs, and asset hot reload. The two planned extensions are Unity-style **texture import
settings** and **sprite-sheet definitions** stored in `.meta`.

---

## Store & handles

- ✅ **`Assets<T>` store** (ADR-0055) — monotonic non-recycled indices, GUID index, `add`/`get`/`getMut`/
  `insert`/`remove`/`reserveHandle`/`handleByGuid`, buffered lifecycle events (`added`/`modified`/`removed`)
  drained per-frame.
- ✅ **Handles** — `Handle<T> = { index, guid? }`, phantom-typed, keeps nothing alive. `AssetId`/`AssetGuid`
  (v4 UUID) / `AssetIndex`; sub-asset composite GUIDs `"<parentGuid>#<label>"` (ADR-0126).

## Asset server (loading)

- ✅ **Server** (`engine/src/asset/asset-server.ts`, ADR-0056) — sync `load(path)` returns a handle
  immediately, IO+decode off-schedule, `PreUpdate` drain commits into stores. Loaders by extension **and
  by kind** (many-types-one-extension). `loadByGuid` via manifest (ADR-0066), sub-asset resolution,
  `LoadContext.read`/`addLabeledAsset` for containers, `reload`/`unloadByGuid`, sticky per-GUID errors,
  `settle()`. Injected `AssetSource`/`AssetSink` (fetch/memory/HTTP-post/project-save).
- ✅ **Selective streaming** (ADR-0100) — reflect handle-ref walker + load-on-demand resolver in
  `spawnScene` (replaces bulk preload); `unloadUnusedAssets`.

## Kinds, `.meta` sidecars, GUIDs

- ✅ **Kind registry** (ADR-0111) — `AssetKinds` catalog; each plugin registers an `AssetKindDescriptor`
  (extensions, discoverable, largeBinary, category, `defaultMeta`); extension-conflict detection.
  Registered today: Image, Mesh, Gltf, Scene, Prefab, Bundle, Material (`.remat`), AnimationClip (`.ranim`),
  AnimationController (`.ranimctrl`), AvatarMask (`.ramask`), RetargetRig (`.rerig`), ProxyFitting,
  MorphTarget, ObjMesh, plus texture-atlas/sprite.
- ✅ **`.meta` sidecars** (ADR-0089) — on-discovery `.meta` minting; `.meta` is the committed **GUID source
  of truth**; the manifest is generated (never committed). `AssetStores`/`AssetSerializers` registries
  (ADR-0065/0107/0128).

## Hot reload

- ✅ **Asset hot reload** (ADR-0096) — `AssetServer.reload(path)` re-reads into the same handle, queuing
  `modified` so GPU resources rebuild; the studio drives file-watch → reload (native only).

## glTF import

- ✅ **glTF/GLB** (`packages/gltf`, ADR-0057/0059) — in-house parser (GLB + glTF), accessors/buffers/
  topology, mesh/material/image/sampler mapping, scene instantiation reactor, animation mapping, node
  anchoring, injected image decode, auto-retarget on import (ADR-0127).
- 🟡 **Deferred** — Draco/meshopt/KTX2 compression, `KHR_materials_*` advanced materials,
  `KHR_texture_transform`, tangent generation (MikkTSpace), `TEXCOORD_1`, `GltfExtras`; sub-asset stable
  GUIDs + bake-vs-reference on save (backlog/gltf-sub-asset-identity-and-promotion.md,
  backlog/serialize-gltf-scene-root.md, backlog/sub-asset-enumeration-and-assignment-followups.md).

## On-disk formats (ADR-0089)

- ✅ Authored content → **YAML** (`.rescene`, `.reprefab`, `.ranim*`, `.ramask`, `.rerig`, `.remat`).
- ✅ Project + settings → **TOML** (`project.retroengine`, `editor/settings/*.toml`).
- ✅ Machine state → **JSON**. `.meta` committed; manifest generated.

---

## Planned `.meta` extensions (Unity-style — not built yet)

Both slot onto existing infra (kind registry ADR-0111, sub-asset composite GUIDs ADR-0126, atlas layout
ADR-0032). Tracked in [`../roadmap/MASTER-ROADMAP.md`](../roadmap/MASTER-ROADMAP.md).

- ❌ **Texture import settings** — filter mode (nearest/point · bilinear · trilinear), wrap mode
  (repeat/clamp/mirror), color space (sRGB vs linear), mipmap generation, max size, pixels-per-unit,
  stored in the Image kind's `.meta` and consumed by `RenderImage` sampler/upload (ADR-0030). Crisp
  nearest filtering is required for pixel-art.
- ❌ **Sprite-sheet definitions** — sprite mode single/multiple; grid or manual-rect slicing; per-sprite
  pivot, border (9-slice), PPU in the texture's `.meta`. Each sliced sprite is minted as a **sub-asset
  via composite GUID** (`<parentGuid>#<label>`), feeding `TextureAtlasLayout`/`TextureAtlas` (ADR-0032)
  and 9-slice (ADR-0034). Authored via the planned Sprite Editor (see [`studio-editor.md`](studio-editor.md)).

## Related gaps

- 🟡 Asset file-op undo (backlog/asset-file-op-undo.md), thumbnail cache + rendered geometry previews
  (backlog/asset-thumbnail-cache-and-geometry-previews.md).
- 🟡 The streamable **`.rpak`** game-export asset pack (GUID-keyed TOC → per-asset-compressed blobs) is a
  build-system deliverable — see the roadmap PLATFORM section.
