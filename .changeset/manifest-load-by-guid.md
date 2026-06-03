---
'@retro-engine/assets': minor
'@retro-engine/engine': minor
---

feat(engine): manifest load-by-GUID so saved scenes survive a restart

Per ADR-0066, the read half of the persistent asset tier. A scene serialized in one process now loads in a fresh one over the injected `AssetSource`: re-establish each referenced asset under its **original GUID**, then `spawnScene(app, scene)` resolves with **no caller-injected `resolveHandle`** (the ADR-0065 default resolver finds the loaded handle because it reaches the store carrying its GUID). Browser-native — `FetchAssetSource` reads bytes over HTTP, no filesystem needed. The write/save path, disk/bundle sources, and `.meta` sidecars (ADR-0055 phases 4–6) remain out of scope.

**`@retro-engine/assets`:**

- `parseAssetManifest(text)` folds the on-the-wire JSON shape (`AssetManifestFile { version, entries }`) into an `AssetManifest` keyed by GUID, rejecting a version mismatch, a duplicate GUID, or a malformed entry. `MANIFEST_FORMAT_VERSION` is the current wire version.
- `Assets.reserveHandle(guid?)` gains an optional GUID (additive; default GUID-less, so `load` is unchanged). A slot reserved with a GUID is indexed by `byGuid` once the load drain fills it.

**`@retro-engine/engine`:**

- `AssetServer.loadByGuid<T>(guid)` — the GUID counterpart of `load(path)`. Resolves the GUID through the manifest to a location, then loads via the loader registered for the location's file extension; returns the handle synchronously, value arrives on the `PreUpdate` drain. Idempotent per GUID.
- `AssetServer.setManifest(manifest)` / `loadManifest(location)` — adopt a manifest in memory, or read + parse one through the injected source.
- Loader dispatch stays extension-keyed; the manifest's `kind` is carried as forward-compatible metadata. A missing manifest, an unknown GUID, or an extensionless/loader-less location throws.

Coordination is preload-then-spawn: `loadManifest → loadByGuid → settle → drain → spawnScene`. `spawnScene` and the SceneRoot reactor are untouched. Selective/streamed scene loading is tracked for later.
