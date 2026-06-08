---
'@retro-engine/assets': minor
'@retro-engine/engine': minor
---

feat(engine): project save tier — write a `.retro-project` through a browser sink (ADR-0070)

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
