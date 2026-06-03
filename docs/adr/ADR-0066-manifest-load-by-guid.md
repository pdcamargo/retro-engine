# ADR-0066: Manifest load-by-GUID (persistent asset read path)

- **Status:** Accepted
- **Date:** 2026-06-03

## Context

ADR-0065 made GUID handle resolution automatic within a session: `Assets<T>` carries a `byGuid` index and `spawnScene` resolves a scene's handles through the App's `AssetStores` with no injected resolver — but only for assets already present in their stores. A GUID minted by `add()` is ephemeral: reopen the app, re-add the same mesh, and it gets a new GUID, so a scene saved in one run does not resolve in a fresh one. Nothing re-establishes the original GUIDs.

ADR-0055 designed the persistent tier (manifest, `.meta` sidecars, disk/bundle sources, promotion) and deferred it. This ADR builds the **read half** of that tier's reference-resolution step (`roadmap/asset-system.md` phase 5): a loadable manifest (GUID→location+kind) plus an `AssetServer` path that reads bytes through the injected `AssetSource`, imports them, and inserts the asset under its original GUID — so a fresh App resolves a serialized scene's handles with no caller-injected resolver. It is browser-native: `FetchAssetSource` already reads bytes over HTTP, so no filesystem is required for loading. The write/save path (baking the manifest + asset bytes) needs a write-capable backend and stays deferred. Extends ADR-0055/0065; supersedes none.

## Decision

- **The manifest is a real, loadable thing.** `AssetManifestFile { version, entries: AssetManifestEntry[] }` is the on-the-wire JSON shape; `parseAssetManifest(text)` folds it into the existing `AssetManifest` (a GUID-keyed map), rejecting a version mismatch, a duplicate GUID, or a malformed entry. Manifest types and the parser stay in the `@retro-engine/assets` leaf (pure, no IO).
- **The `AssetServer` owns the manifest.** `setManifest(manifest)` adopts one in memory; `loadManifest(location)` reads its bytes through the injected source and parses them. The server is the single asset entry point and already holds the source, so the manifest is its data — no new App resource.
- **`loadByGuid<T>(guid)` is the read-path primitive**, the GUID counterpart of `load(path)`. It resolves the GUID through the manifest to a location, then loads exactly like `load`: derives the loader from the location's file extension, reserves a slot, runs the read+import off-schedule, and returns the handle synchronously. Idempotent per GUID via a `guidToHandle` dedup map mirroring `pathToHandle`.
- **The reserved slot carries the GUID.** `Assets.reserveHandle(guid?)` gains an optional GUID (additive; default GUID-less, so `load` is unchanged). Because the handle carries the GUID, the `PreUpdate` drain's `insert` registers it in the store's `byGuid`, and ADR-0065's default resolver finds it — so **`spawnScene` needs no change**.
- **Loader dispatch is by file extension**, reusing the existing extension-keyed registry. The manifest's `kind` is carried but is not the dispatch key for this read path; it graduates to one when the bundle/serializer path needs it. An extensionless location is a hard error, like `load`.
- **Missing-GUID policy is to throw**, consistent with ADR-0065: `loadByGuid` throws if no manifest is set, the GUID is absent from it, or no loader matches the location's extension.
- **Coordination is preload-then-spawn:** the caller loads the referenced assets, awaits `settle()`, runs the drain, then spawns. No change to `spawnScene` or the SceneRoot reactor.

## Consequences

- A scene serialized in one process loads in a fresh one over the injected source with no caller glue: `loadManifest → loadByGuid → settle → drain → spawnScene`. The end-to-end test proves it with a fresh App and a stubbed source.
- `spawnScene` is untouched. The whole read path slots in under ADR-0065's resolver because the loaded handle reaches the store carrying its GUID.
- A load failure surfaces late: the slot stays empty, `byGuid` is never populated, and the error appears at `spawnScene` as "asset not present in its store", not at load time. Acceptable for a read slice.
- Interim coarseness, tracked in `docs/backlog/scene-aware-asset-streaming.md`: the caller preloads the whole manifest (no scan of which assets a scene actually references), there is no background load on scene swap, and nothing unloads assets a scene no longer needs. Selective load (a reflect handle-ref scanner), background streaming, unload, and reactor-driven deferred resolution are the next step.
- `kind` is unused for dispatch until the bundle path exists; it stays in the manifest as forward-compatible metadata rather than being dropped and re-added.
- Out of scope, still deferred (ADR-0055 / roadmap phases 4–6): the write/save path, `.meta` sidecars, `DiskAssetSource` / `BundleAssetSource`, the `.retro-project` layout, studio integration, hot-reload.
- No benchmark: manifest parse + `loadByGuid` are one-shot load-time and touch no per-frame path (CLAUDE.md §11).

## Implementation

- `packages/assets/src/manifest.ts` — `MANIFEST_FORMAT_VERSION`, `AssetManifestFile`, `parseAssetManifest`
- `packages/assets/src/assets.ts` — `Assets.reserveHandle(guid?)` (GUID-carrying reserve)
- `packages/assets/src/index.ts` — re-exports the manifest parser, version, and wire type
- `packages/engine/src/asset/asset-server.ts` — `AssetServer.setManifest`, `loadManifest`, `loadByGuid`; the `manifest` field and `guidToHandle` dedup map
- `packages/assets/src/manifest.test.ts`, `packages/assets/src/assets-guid.test.ts` — parser + reserve-by-GUID coverage
- `packages/engine/src/asset/asset-server.test.ts` — `loadByGuid` / `loadManifest` over a stub source
- `packages/engine/src/scene/scene-load-by-guid-3d.test.ts` — fresh-App end-to-end proof
