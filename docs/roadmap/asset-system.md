# Asset System

- **Created:** 2026-05-21
- **Status:** Runtime core + retrofit shipped (phases 1–3); persistent project tier + studio (phases 4–6) deferred to a later initiative
- **Decision:** ADR-0055 (seals the id / handle / asset-vs-inline model, including the deferred persistent GUID tier)

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

**Deferred (designed in ADR-0055, built as a later initiative — the persistent project tier):**

4. **Project format** — `.retro-project` layout, GUID `.meta` sidecars, manifest. JSON for v1.
5. **Reference resolution + sources** — `DiskAssetSource` / `BundleAssetSource`, GUID→index
   resolution on load, promotion (`CreateAsset` analogue: runtime asset → GUID-backed project asset).
6. **Studio integration** — asset browser, drag-drop into scene, rename without breaking references,
   hot-reload, inspector-dirty → serialize.

(Scene system moved to its own roadmap: `docs/roadmap/scenes-and-prefabs.md`.)

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
