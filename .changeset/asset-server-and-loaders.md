---
'@retro-engine/engine': minor
---

feat(engine): asset server, loaders, and AssetPlugin

Adds the engine-side loading layer over the `@retro-engine/assets` primitives. `engine` now depends on `assets` (the dependency runs `engine → assets` only).

**New public surface:**

- `AssetServer` — the single load entry point. `load<T>(path)` reserves a store slot and returns a `Handle<T>` **synchronously**; the read + decode run off-schedule and their result lands in an internal completion queue. `registerLoader(extension, store, importer)` binds a file extension to a target `Assets<T>` store and an importer (the store is bound at registration because `load` is given only a path and each asset type has its own store). `reload(path)` re-reads into the existing handle (hot-reload, stable handle, queues `modified`). `load` is idempotent per path. `settle()` / `pendingCount` aid tests and loading screens — `settle` is not the load API.
- `FetchAssetSource` — the web `AssetSource`, `fetch`-backed, with an `ok` check and optional `baseUrl`. Disk and bundle sources are injected in their own environments.
- `AssetPlugin` — inserts `AssetServer` (with an injected or default `FetchAssetSource`) and installs the `PreUpdate` load-drain system. Not auto-added by `CorePlugin`; add it explicitly. Loaders register separately via `AssetServer.registerLoader`.
- `applyCompletedLoads` — the drain: commits completed loads into their stores (queuing the store's `added` / `modified` event) and reports failures. Runs in `PreUpdate`, so a load finished this frame is in its store before the render stage extracts it.
- `CompletedLoad` / `AssetLoadFailure` types.
- Passthrough re-exports of `Assets`, `makeHandle`, `handleEq`, and the `Handle` / `AssetEvent` / `AssetSource` / `AssetImporter` / `AssetImportContext` types from `@retro-engine/assets`, so consumers of `load<T>(): Handle<T>` get the types without depending on the leaf directly.

No existing engine behaviour changes: nothing is auto-wired and the four current asset registries (Image / Mesh / Material / atlas) are untouched.
