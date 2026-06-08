# Asset System

- **Created:** 2026-05-21
- **Status:** Runtime core + retrofit shipped (phases 1–3); persistent project save tier shipped browser-first (phases 4–5 write half — ADR-0070); native disk/bundle sources and studio (phase 6) deferred
- **Decision:** ADR-0055 (seals the id / handle / asset-vs-inline model, including the deferred persistent GUID tier); ADR-0066 (read half); ADR-0070 (write half + write sink)

## Goal

`packages/assets` provides one asset concept addressed by `Handle<T>`. At runtime an asset is keyed by
a dense `AssetIndex` (the hot path); persistent project assets additionally carry a stable v4
`AssetGuid` that survives rename. Project save/load round-trips assets, scenes, and references intact.
Importers and serializers register against a central registry; new asset types are added by
registration, not by inheritance. The system **absorbs** the engine's existing `Image` / `Mesh` /
`Material` / `TextureAtlasLayout` registries rather than standing beside them.

## Phases

**Active slice (this initiative — runtime core + retrofit). Shipped:**

1. **Asset id and handle types** — `AssetIndex` / `AssetGuid` / `AssetId<T>` / `Handle<T>` (phantom-
   typed) + generic `Assets<T>` store + `AssetEvent<T>`. ✅ Shipped.
2. **Asset server + loader registries** — `AssetServer` (immediate handle, schedule-bound drain),
   `AssetPlugin`, importer/serializer registries, `FetchAssetSource`, `AssetSource` interface.
   ✅ Shipped.
3. **Retrofit** — fold the four existing types into `Assets<T>`, big-bang, keyed on `handle.index`.
   ✅ Shipped.

**Persistent project tier (designed in ADR-0055):**

4. **Project format** — `.retro-project` layout, GUID `.meta` sidecars, manifest. JSON for v1.
   ✅ Shipped (ADR-0070): `serializeProject` emits the `.retro-project` layout (`project.json` +
   `assets.manifest.json` + `scenes/*.scene` + `assets/<guid>.<ext>` + `<…>.meta`), `bakeManifest` /
   `serializeAssetManifest` are the inverse of `parseAssetManifest`, and `.meta` sidecars are written
   for forward-compat (the read path resolves via the manifest).
5. **Reference resolution + sources** — GUID→index resolution on load, promotion (`CreateAsset`
   analogue: runtime asset → GUID-backed project asset), then `DiskAssetSource` / `BundleAssetSource`.
   The **in-memory** slice of GUID→handle resolution shipped early (ADR-0065). The **read half** then
   shipped (ADR-0066): a loadable manifest + `AssetServer.loadByGuid`, browser-native over
   `FetchAssetSource`. The **write half** now shipped (ADR-0070): `serializeProject` produces the
   manifest + scene docs + promoted asset bytes as **pure data**, written through a swappable
   `AssetSink` (DI mirror of `AssetSource`); `promoteAsset` is the `CreateAsset` analogue; the v1
   browser sink (`HttpPostAssetSink`) pairs with `FetchAssetSource` for a browser→disk→browser
   round-trip. Remaining here: `DiskAssetSource` / `BundleAssetSource` + a native disk sink (studio,
   drop-in via `AssetSink`). Selective/streamed scene loading is tracked in
   `docs/backlog/scene-aware-asset-streaming.md`.
6. **Studio integration** — asset browser, drag-drop into scene, rename without breaking references,
   hot-reload, inspector-dirty → serialize. Deferred.

(Scene system moved to its own roadmap: `docs/roadmap/scenes-and-prefabs.md`.)

**Additive extension (ADR-0056):** the runtime core gains a `LoadContext` (sibling `read` +
`addLabeledAsset` + atomic on-schedule multi-asset commit) so multi-file formats — glTF first
(`docs/roadmap/gltf.md`, ADR-0057) — can load dependency graphs. It is purely additive to the
ADR-0055 importer contract; single-file importers are unaffected.

## Resolved (ADR-0055)

- **GUID generation** → random v4. Identity must survive edits and renames; content-addressing severs
  references on every edit. Content hashing is a future dedup *cache* key, never the identity.
- **Handle lifecycle** → plain value handles, explicit/bulk release, no `Arc`/`Drop`, no strong/weak
  split. JS has no deterministic destructor and `FinalizationRegistry` is unsuitable, so auto-unload-
  on-last-drop is impossible; lifetime is owned by the store and released explicitly or via scene
  teardown.
- **Async loading** → immediate handle + schedule-bound drain (`load()` returns synchronously, IO via
  promise, a `PreUpdate` system populates the store before `RenderSet.Extract`).
- **Editor vs runtime** → one `AssetServer`, a swappable `AssetSource` (web fetch source now; disk and
  bundle sources designed, deferred).

## Links

- Unity's AssetDatabase (reference for the studio-side)
- Bevy's `AssetServer` (reference for runtime API)
