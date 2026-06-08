# ADR-0070: Project save format + write sink

- **Status:** Accepted
- **Date:** 2026-06-08

## Context

ADR-0066 built the **read half** of the persistent asset tier: a loadable manifest
(`parseAssetManifest`) and `AssetServer.loadByGuid`, browser-native over
`FetchAssetSource`. ADR-0055 designed the **write half** (manifest baking, `.meta`
sidecars, promotion, disk/bundle sources) and deferred it. ADR-0069 made resources
reflectable, so a saved scene can restore its world settings. What remained: the
engine could not **save**. There was no manifest baking, no promotion (runtime asset
→ GUID-backed project asset), no `.retro-project` format, and no write-capable
backend.

The constraint that makes building this now correct: the save tier is the **symmetric
mirror** of the read tier. The read side resolved on one `AssetServer` + a swappable
`AssetSource` (`FetchAssetSource` now; disk/bundle deferred). The write side is a
swappable write **sink** on the same dependency-injection seam. The engine's
serialization layer must produce **pure data** and perform **no I/O**; a sink writes
it. `packages/engine` and `packages/assets` must import no Tauri, no Node `fs`, no
platform write API — the native/disk sink is deferred to the studio and injected at
the app layer, exactly the way the renderer backend is.

## Decision

- **`AssetSink { write(location, bytes): Promise<void> }`** in `@retro-engine/assets`
  is the single-method write mirror of `AssetSource.read`. No transaction/commit
  concept (the read side has none); a project is written by looping over its files.
- **`serializeProject(app, opts): SavedProject` produces pure data, no I/O.** It emits:
  the **manifest** (exactly the shape `parseAssetManifest` reads, via additive
  `bakeManifest` + `serializeAssetManifest` in the assets leaf); the **scene
  documents** (each a GUID-addressable asset — the `SceneData` JSON *is* the bytes,
  carrying its resources from ADR-0069); the **promoted referenced-asset** bytes;
  `.meta` sidecars; and the **`.retro-project`** index. `SavedProject.files` is the
  `{ location, bytes }[]` a caller writes through an `AssetSink`.
- **Promotion freezes identity rather than minting it.** Every `Assets.add`'d asset
  already carries a GUID (ADR-0065), so `promoteAsset` writes the asset's bytes through
  its kind's serializer, emits a manifest entry keyed by the handle's existing GUID,
  and writes a `.meta` sidecar — the "CreateAsset analogue" from ADR-0055.
- **Serializers are first-class, mirroring importers.** A concrete `AssetSerializers`
  registry (engine) is populated per owning plugin via `registerAssetSerializer`
  (get-or-create, so registration is plugin-order-independent). `MeshPlugin` registers
  the **mesh** serializer; a `.rmesh` importer/serializer pair (versioned UTF-8 JSON
  envelope) makes a *referenced binary asset* both promotable and reloadable via
  `loadByGuid`'s extension dispatch. Scenes serialize inline (their document is the
  bytes), under manifest `kind` `Scene`, reloaded by the existing `.scene` importer.
- **`.meta` is forward-compat only.** The sidecar (`{ version, guid }`, JSON v1) pins a
  GUID to a file so a future studio can rename without breaking references, but the
  read path resolves GUIDs through the **manifest**, not `.meta` — so a project loads
  with `.meta` ignored.
- **`.retro-project` layout:** `project.json` (index: version, manifest location,
  scene GUIDs) + `assets.manifest.json` + `scenes/<name>.scene` +
  `assets/<guid>.<ext>` + `<…>.meta`.
- **The sink is injected via DI, exactly like the read source.** `AssetPlugin` accepts
  an optional `sink` and holds it in a `ProjectSaveSink` resource (App resources are
  ctor-keyed, so an interface needs a holder, the same reason `AssetServer` wraps its
  source). Save-triggering code reads `ProjectSaveSink.sink`; the engine names only the
  `AssetSink` interface.
- **v1 browser sink: `HttpPostAssetSink`** (fetch `PUT`). It works in every browser
  with no user gesture and pairs with the existing `FetchAssetSource` read path for a
  true browser→disk→browser round-trip, via a dev-server write route. The File System
  Access API sink (Chromium-only, user-gesture gated, and needing a matching
  FS-Access *read* source that does not exist yet) is the documented additive sink.
- **Engine-stays-platform-free (restated so it is not re-litigated):**
  `serializeProject` / `promoteAsset` return data and never call `write`;
  `HttpPostAssetSink` uses only `fetch`; the Bun dev-server write route that calls
  `Bun.write` lives in `apps/playground` (not a shipped package). No `@retro-engine/*`
  package imports Tauri or Node `fs`.

## Consequences

- A whole project — scene(s) + resources + promoted assets — saves through a
  browser-viable sink and reloads faithfully in a fresh App through the **existing**
  read path (`loadManifest → loadByGuid → settle → drain → spawnScene`). Proven by an
  in-memory-sink round-trip test and the `?mode=save` playground showcase
  (browser→disk→browser).
- The sink abstraction makes a Tauri/native disk sink and a bundle sink drop-ins — no
  engine change, injected at startup like the renderer.
- The `.rmesh` format is a JSON envelope of numeric arrays for v1: lossless for f32 and
  the integer index widths, and browser-safe (no `Buffer`/base64). A compact binary
  form, and serializers for other kinds (images, materials), follow the same
  importer/serializer pattern and are deferred.
- Save/promotion is one-shot at author time, but per-asset serialize cost grows with
  content, so the bulk `serializeProject` path is benched (CLAUDE.md §11). Resource and
  scene decode at load is one-shot — no bench.
- Out of scope, deferred (note in roadmap, not silently dropped): the File System
  Access sink; `DiskAssetSource`/`BundleAssetSource` + native disk sink (studio);
  selective/streamed loading (`docs/backlog/scene-aware-asset-streaming.md`);
  hot-reload (save is its prerequisite); studio integration (asset browser, drag-drop,
  rename-without-breaking-refs UI, inspector-dirty→save); content-hash dedup; binding
  restored resources into state-scoped `OnExit` removal; richer `.meta` import settings.

## Implementation

- `packages/assets/src/sink.ts` — `AssetSink`
- `packages/assets/src/manifest.ts` — `bakeManifest`, `serializeAssetManifest`
- `packages/engine/src/asset/asset-serializers.ts` — `AssetSerializers`, `registerAssetSerializer`
- `packages/engine/src/asset/post-sink.ts` — `HttpPostAssetSink`
- `packages/engine/src/asset/memory-sink.ts` — `MemoryAssetSink`, `MemoryAssetSource`
- `packages/engine/src/asset/project-save-sink.ts` — `ProjectSaveSink`
- `packages/engine/src/asset/asset-plugin.ts` — `AssetPlugin` `sink` option
- `packages/engine/src/asset/asset-stores.ts` — `AssetStores.storeFor`
- `packages/engine/src/mesh/mesh-importer.ts` — `createMeshImporter`, `createMeshSerializer`, `MESH_FORMAT_VERSION`
- `packages/engine/src/mesh/mesh-plugin.ts` — registers the mesh serializer
- `packages/engine/src/save/` — `serializeProject`, `promoteAsset`, `.meta` baking, `SavedProject` / `ProjectDocFile` / `PROJECT_FORMAT_VERSION` / `SCENE_ASSET_KIND`
- `packages/assets/src/manifest.test.ts`, `packages/engine/src/mesh/mesh-importer.test.ts`, `packages/engine/src/asset/sink.test.ts`, `packages/engine/src/save/project-roundtrip.test.ts` — coverage
- `packages/engine/bench/save-promote.bench.ts` — content-scaling save/promote bench
- `apps/playground/dev-server.ts`, `apps/playground/src/save-showcase-plugin.ts` — dev-server write route + `?mode=save` showcase
