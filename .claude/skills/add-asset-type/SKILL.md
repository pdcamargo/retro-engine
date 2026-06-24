---
name: add-asset-type
description: Add a new asset type to the Retro Engine asset/sidecar system end-to-end — register its kind descriptor, loader, serializer, sidecar metadata, and studio browser display. Use when introducing a new asset kind (a new file format the engine loads, or a new authored asset) so it is discovered, identified by GUID via a `.meta` sidecar, loadable, and shown correctly in the studio asset browser.
---

# Add a new asset type

The asset system is governed by [ADR-0111](../../../docs/adr/ADR-0111-asset-kind-registry-and-sidecar-generation.md)
(kind registry + sidecar generation), [ADR-0055](../../../docs/adr/ADR-0055-asset-system.md)
(Id/Handle/Store), [ADR-0089](../../../docs/adr/ADR-0089-on-disk-formats-yaml-toml-meta.md)
(`.meta` as identity), and [ADR-0107](../../../docs/adr/ADR-0107-materials-as-assets.md)
(many-kinds-one-extension via kind-routed loading). Read those if a step's *why* is unclear.

Each asset type is identified by a **`kind`** string (the tag in its `.meta` sidecar and
manifest entry). The catalog of kinds is the `AssetKinds` resource. Adding a type is mostly
"register one descriptor + wire its loader"; the rest follows.

## Decide first

1. **`kind`** — a stable string tag (e.g. `'Gltf'`, `'Image'`). Defaults to a class name for
   reflected value types; otherwise pick a stable PascalCase tag.
2. **Extensions** — the file extensions it claims, dot-free and lowercased (`['glb', 'gltf']`).
3. **Discoverable?** — `true` if it is a *source* asset a user drops into the project (images,
   models): a loose file with no sidecar gets one minted on discovery. `false` if the file only
   ever exists because a **save** wrote it *with* a sidecar (meshes `.rmesh`, scenes `.rescene`,
   bundles `.rebundle`, materials `.remat`) — a loose one of those is a corruption, not a
   discovery. When unsure, it is almost certainly `false`.
4. **Category** — the studio UI bucket (`'model'`, `'image'`, `'mesh'`, `'material'`, `'scene'`,
   `'bundle'`, `'sprite'`, …). Maps to an `AssetType` in the browser.

## Steps

### 1. Register the kind descriptor (required)

In the owning plugin's `build()`, next to its store/loader/serializer registration:

```ts
import { registerAssetKind } from '@retro-engine/engine'; // or '../asset/asset-kinds' inside engine

registerAssetKind(app, {
  kind: 'MyKind',
  extensions: ['myext'],
  discoverable: true,        // see "Decide first" #3
  largeBinary: true,         // optional: streamed bytes (textures, models)
  category: 'model',         // optional UI hint; the studio maps it to an AssetType
  defaultMeta: () => ({}),   // optional: per-kind sidecar `data` body for a freshly minted asset
});
```

For a type living in its own package (like glTF), export the descriptor as a shared constant
(`packages/gltf/src/gltf-asset-kind.ts` → `gltfAssetKindDescriptor`) so both the plugin and any
catalog-only consumer (the studio) register the same one. Do **not** import `editor-sdk` from the
engine — that is why `category` is a plain string, not an `AssetType`.

### 2. Register the loader (required to load it)

In the same `build()`, on the `AssetServer`:

- One extension → one store: `server.registerLoader('myext', myStore, myImporter)`.
- Many kinds → one extension (the materials pattern): `server.registerLoaderByKind(kind, store, importer)`
  and route by kind. See `registerMaterialLoaders` in `packages/engine/src/material/material-types.ts`.

The importer is an `AssetImporter<T>` decoding bytes → asset value. Reference: `createMeshImporter`,
`createHdrImporter`, `createGltfImporter`.

### 3. Make it persistable (only if the studio saves it)

If the asset is authored/edited in the studio and written back on save, register an
`AssetSerializer<T>` keyed by `kind`:

```ts
registerAssetSerializer(app, 'MyKind', createMySerializer());
```

Pure source assets (images, glTF) are read-only — skip this.

### 4. Studio browser display

`apps/studio/src/project/project-browser.ts` maps `kind → AssetType` via the descriptor's
`category` (preferred) with a fallback switch. If you used a `category` already in
`CATEGORY_TO_ASSET_TYPE`, nothing to do. For a brand-new category:

- Add it to `CATEGORY_TO_ASSET_TYPE` in `project-browser.ts`.
- Ensure the `AssetType` exists in `packages/editor-sdk/src/components-asset.ts` (`AssetType`
  union + `ASSET_TYPES` icon/tag/tone). Add a new `AssetType` only if none fits.

### 5. Sidecar `data` (only for richer per-kind metadata)

The `.meta` format has an optional `data` body (`AssetMetaData`) for import settings / authored
sub-assets (e.g. a texture's sprite rect map). Populate defaults via the descriptor's
`defaultMeta()`. The shape is owned by your kind. Round-tripping `data` through the reflection
codec for an inspector is the documented growth path — see ADR-0111.

### 6. Thumbnails (optional)

`apps/studio/src/thumbnails/thumbnail-service.ts` generates previews for images / `.rmesh` /
`.remat`. Extend its `generate()` branch for a new previewable type, and the `thumbnailable`
logic in `buildBrowserAssets`. Otherwise the browser shows the category's procedural icon.

## Verify

- Unit-test the importer and (if added) the serializer round-trip.
- If discoverable, confirm `generateMissingSidecars` mints a sidecar for a loose file of your
  extension (see `packages/engine/src/save/generate-sidecars.test.ts` for the pattern).
- In the studio (retro-studio MCP / run the app): a loose file appears in the Assets panel with
  the right icon, and a `<file>.meta` exists on disk.

## Touchpoint summary

| Concern | Where |
|---|---|
| Kind catalog | `registerAssetKind(app, …)` in the owning plugin `build()` |
| Loader | `AssetServer.registerLoader` / `registerLoaderByKind` |
| Serializer (if saved) | `registerAssetSerializer(app, kind, …)` |
| Store | `registerAssetStore(app, kind, store)` |
| Discovery / sidecar minting | follows from `discoverable: true` — no extra code |
| Browser category | `category` on the descriptor; `CATEGORY_TO_ASSET_TYPE` + `AssetType`/`ASSET_TYPES` if new |
| Sidecar metadata | `defaultMeta` + `AssetMetaData` |
| Thumbnail | `thumbnail-service.ts` (optional) |
