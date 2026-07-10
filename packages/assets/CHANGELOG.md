# @retro-engine/assets

## 0.1.0

### Minor Changes

- 937f2cb: feat(engine): automatic GUID handle resolution for scenes

  Per ADR-0065, a saved scene now restores its asset handles by GUID with **no caller-injected `resolveHandle`**. `spawnScene(app, scene)` resolves a referenced mesh, material, sprite texture, or atlas against the assets already in their stores — closing the resolver-injection cost ADR-0064 had accepted. This is the scene-blocking slice of the persistent asset tier; the manifest, `.meta` sidecars, disk/bundle sources, and load-on-demand-by-GUID (ADR-0055 phases 4–6) remain out of scope.

  **`@retro-engine/assets`:**

  - `Assets<T>` now indexes every value by its `AssetGuid`. `add(value, guid?)` mints a fresh v4 GUID when none is supplied — so every in-memory asset is serializable and resolvable by default — or adopts an explicit one (the manifest/loader path).
  - `Assets.handleByGuid(guid)` resolves a persistent GUID back to its live store slot. `insert` indexes a GUID-bearing handle; `remove` drops it. `reserveHandle` stays GUID-less.

  **`@retro-engine/engine`:**

  - New `AssetStores` resource maps each reflection asset-type key to its owning `Assets` store; `registerAssetStore(app, key, store)` populates it from a store-owning plugin's `build`. `ASSET_TYPE` exposes the fixed-store keys (`'Mesh'`, `'Image'`, `'TextureAtlasLayout'`).
  - `spawnScene` builds the default resolver from the App's `AssetStores` when no `resolveHandle` is passed; an injected resolver still overrides. A referenced GUID absent from its store throws.
  - Material handle fields now key on a **per-class** asset type (`Materials<M>` / `Materials2d<M>`) instead of the previously-ambiguous shared `'Materials'` / `'Materials2d'`. The serialized scene stores only the GUID, so existing scenes are unaffected.

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

- 2ea4d68: feat(build): bake `.meta` import settings into the export manifest

  Exported games now apply per-asset import settings (a texture's `filter` /
  `colorSpace`, etc.) — previously lost because the `.meta` sidecars weren't packed
  into the `.rpak`, so every texture fell back to the project default (ADR-0172).

  `AssetManifestEntry` gains an optional `meta` field (the sidecar's fields beyond
  `version`/`guid`/`kind`); the build scan (`parseMetaEntry`) bakes it, and
  `RpakAssetSource` synthesizes the `<name>.meta` read from it — so the engine's
  image importer (which reads `ctx.read('<name>.meta')`) gets the settings in the
  bundle unchanged. Assets whose sidecar carries no settings get no `meta`, keeping
  the manifest lean; the importer's "no sidecar → defaults" path is preserved.
  Generic (any sidecar-reading importer benefits). Unit-tested; the sample-game
  export manifest is unchanged for its settingless asset.

- 3db9d87: feat(engine): manifest load-by-GUID so saved scenes survive a restart

  Per ADR-0066, the read half of the persistent asset tier. A scene serialized in one process now loads in a fresh one over the injected `AssetSource`: re-establish each referenced asset under its **original GUID**, then `spawnScene(app, scene)` resolves with **no caller-injected `resolveHandle`** (the ADR-0065 default resolver finds the loaded handle because it reaches the store carrying its GUID). Browser-native — `FetchAssetSource` reads bytes over HTTP, no filesystem needed. The write/save path, disk/bundle sources, and `.meta` sidecars (ADR-0055 phases 4–6) remain out of scope.

  **`@retro-engine/assets`:**

  - `parseAssetManifest(text)` folds the on-the-wire JSON shape (`AssetManifestFile { version, entries }`) into an `AssetManifest` keyed by GUID, rejecting a version mismatch, a duplicate GUID, or a malformed entry. `MANIFEST_FORMAT_VERSION` is the current wire version.
  - `Assets.reserveHandle(guid?)` gains an optional GUID (additive; default GUID-less, so `load` is unchanged). A slot reserved with a GUID is indexed by `byGuid` once the load drain fills it.

  **`@retro-engine/engine`:**

  - `AssetServer.loadByGuid<T>(guid)` — the GUID counterpart of `load(path)`. Resolves the GUID through the manifest to a location, then loads via the loader registered for the location's file extension; returns the handle synchronously, value arrives on the `PreUpdate` drain. Idempotent per GUID.
  - `AssetServer.setManifest(manifest)` / `loadManifest(location)` — adopt a manifest in memory, or read + parse one through the injected source.
  - Loader dispatch stays extension-keyed; the manifest's `kind` is carried as forward-compatible metadata. A missing manifest, an unknown GUID, or an extensionless/loader-less location throws.

  Coordination is preload-then-spawn: `loadManifest → loadByGuid → settle → drain → spawnScene`. `spawnScene` and the SceneRoot reactor are untouched. Selective/streamed scene loading is tracked for later.

- 67e8513: feat(engine): project save tier — write a `.retro-project` through a browser sink (ADR-0070)

  The write half of the persistent asset tier (ADR-0055 phases 4–6), the symmetric mirror of the ADR-0066 read half. The serialization layer produces **pure data**; a swappable write **sink** on the same DI seam as `AssetSource` writes it. `@retro-engine/engine` and `@retro-engine/assets` import no Tauri, no Node `fs`, no platform write API — the native/disk sink drops in at the app layer, like the renderer backend.

  **`@retro-engine/assets`:**

  - `AssetSink { write(location, bytes): Promise<void> }` — the single-method write mirror of `AssetSource`.
  - `bakeManifest(entries)` / `serializeAssetManifest(file)` — the inverse of `parseAssetManifest`: `parseAssetManifest(serializeAssetManifest(bakeManifest(e)))` reproduces the entry map.

  **`@retro-engine/engine`:**

  - `serializeProject(app, opts)` → `SavedProject` — produces, as pure data, the manifest, the scene documents (each a GUID-addressable asset carrying its resources), promoted referenced-asset bytes, `.meta` sidecars, and the `.retro-project` index. No I/O — the caller writes `SavedProject.files` through an `AssetSink`.
  - `promoteAsset(handle, value, kind, serializer, opts)` — freezes a runtime asset's existing GUID into a project asset (bytes + manifest entry + `.meta`); the "CreateAsset analogue".
  - `AssetSerializers` + `registerAssetSerializer(app, kind, serializer)` — serializers become first-class like importers, registered per owning plugin. `createMeshImporter` / `createMeshSerializer` (`.rmesh`, `MESH_FORMAT_VERSION`) make a referenced mesh promotable and reloadable by `loadByGuid`.
  - `HttpPostAssetSink` (browser, `fetch` `PUT`) — the v1 sink; pairs with `FetchAssetSource` for a browser→disk→browser round-trip. `MemoryAssetSink` / `MemoryAssetSource` for in-process round-trips and tests. `ProjectSaveSink` holds the injected sink; `AssetPlugin` gains a `sink` option. `AssetStores.storeFor(kind)`.

  A whole project — scenes + resources + promoted assets — saves through a browser sink and reloads faithfully through the existing read path (`loadManifest → loadByGuid → spawnScene`) in a fresh App. The File System Access sink, native disk/bundle sinks, selective/streamed loading, and hot-reload remain deferred.

- acae153: feat: sub-asset references + derived-asset asset browser

  Per ADR-0126, gives a container's decoded children (a model's meshes, materials, and animation clips) a persistent, resolvable identity so a saved reference to one survives reload — and surfaces them in the studio's rebuilt asset browser.

  **`@retro-engine/assets`** — `subAssetGuid(parent, label)` / `parseSubAssetGuid(guid)`: the composite GUID-URI (`"<parentGuid>#<label>"`) that names a labeled sub-asset deterministically from its container's GUID. A single string, so it serializes and resolves exactly like a top-level GUID.

  **`@retro-engine/engine`** — `AssetServer.registerSubAssetStore(prefix, store)` binds a label prefix to the store that holds those sub-assets; `loadByGuid` now resolves a sub-asset reference by reserving the slot and loading the parent so its `addLabeledAsset` fills it (matched by GUID), and `hasGuid` recognizes sub-refs whose container is resolvable. `addLabeledAsset` mints the deterministic sub-GUID when a parent GUID is present. The glTF `AnimationPlugin` registers the `Animation` prefix, so a model's clips are assignable to a `Handle<AnimationClip>` field and round-trip through scene save/load. `subAssetGuid` / `parseSubAssetGuid` are re-exported.

  **`@retro-engine/editor-sdk`** — `assetCard` returns `AssetCardResult` (`{ clicked, expandToggled, checkToggled, rightClicked }`) and takes an `onContextMenu` hook anchored to the tile; its error preview uses the triangle-alert glyph and sprites get a dashed cyan crop frame; the fold chip moved to the top-right to clear the type tag. `assetGroup` is generalized from sprite-only to any source file's mixed children: it takes `headerType` (drives the icon/tone) and a `summary` string instead of a sprite count, and draws the inset accent rail.
