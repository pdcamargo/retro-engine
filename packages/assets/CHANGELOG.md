# @retro-engine/assets

## 0.1.0

### Minor Changes

- d5424c3: feat(assets): LoadContext + dependency-aware loading

  Widens the importer context so a single importer can pull in related resources and register the sub-assets a composite file decodes into — the prerequisite for multi-file formats (a model with external buffers/images, an atlas with a sidecar).

  **Public surface (`@retro-engine/assets`, re-exported from `@retro-engine/engine`):**

  - `LoadContext` replaces `AssetImportContext`. It keeps `path` and adds:
    - `read(relativePath): Promise<Uint8Array>` — read a resource referenced relative to this asset, resolved against the directory of `path` and fetched through the same source the root load used. A `data:` URI is decoded inline and never hits the source. The importer awaits these reads, so an asset is not loaded until its dependencies resolve.
    - `addLabeledAsset<U>(label, value, store): Handle<U>` — register a decoded sub-asset into `store` and get its handle back to wire into the composite value. The store is passed explicitly, keeping the server asset-type-agnostic.
  - `AssetImporter<T>` now receives a `LoadContext`. The change is additive: existing single-file importers (which read only `ctx.path`) compile and behave unchanged.

  **Behaviour (`AssetServer`):**

  - `runLoad` constructs the `LoadContext`. Sibling paths resolve by string join against the path's directory (source-agnostic — no `new URL`), so a source's own base resolution composes on top.
  - Sub-assets reserve a handle immediately (no event queued) and buffer locally; on importer resolution the whole subgraph — sub-assets before root — is committed in one `PreUpdate` drain pass, before the render stage extracts any of it.
  - Failure stays all-or-nothing: a throwing importer commits no partial subgraph; reserved sub-asset slots are simply never filled; `AssetLoadFailure` records the error unchanged.

- c1b257b: feat(assets): asset identity and storage primitives — `Handle<T>`, id model, `Assets<T>` store, registry/source types

  Stands up the new `@retro-engine/assets` leaf package (zero internal deps). It generalizes the per-type registries the engine grew for meshes, images, materials, and atlas layouts into one shape, without yet retrofitting any of them.

  **New public surface:**

  - `AssetIndex` — branded `number`, the dense runtime slot and hot-path lookup key. Minted monotonically with no reuse.
  - `AssetGuid` — branded `string`, a random v4 UUID; the persistent identity and serialization key. `generateAssetGuid()` mints one.
  - `AssetId<T>` — logical identity: `{ kind: 'runtime', index }` or `{ kind: 'guid', guid, index }`. `assetIndexOf(id)` returns the store key. `asAssetIndex(n)` brands a raw number.
  - `Handle<T>` — cheap value reference: `index`, optional `guid`, phantom `T` so `Handle<Mesh>` is not assignable to `Handle<Image>`. `makeHandle(index, guid?)` builds one; `handleEq` compares by index.
  - `Assets<T>` — generic store over `Map<AssetIndex, T>`: `add` → `Handle<T>`, `get`, `getMut` (queues `modified`), `insert`, `remove` (queues `removed`), `reserveHandle` (async-load slot), `has`, `size`, `iter`, `drainEvents`.
  - `AssetEvent<T>` — `added | modified | removed | unused`, each carrying the handle (`unused` is tooling-only; nothing frees on it).
  - `AssetImporter<T>` / `AssetImportContext` / `AssetImporterRegistry`, `AssetSerializer<T>` / `AssetSerializerRegistry` — strategy registry **types** only, no wiring.
  - `AssetSource`, `AssetManifest` / `AssetManifestEntry` — the swappable byte source and GUID→location manifest, designed as types only; concrete sources land later.

  No behavior change anywhere else — the engine does not import this package yet.
