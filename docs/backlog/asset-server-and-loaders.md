# Asset server, plugin, and loader registries

- **Created:** 2026-05-31

## Context

Phase 2 of the asset system (ADR-0055). Engine-side wiring that consumes `packages/assets`, standing
**beside** the existing `Meshes`/`Images`/`Materials` registries — no retrofit yet, so the engine is
unchanged in behavior and the new path is exercised in isolation.

Build under `packages/engine/src/asset/`:

- `AssetServer` (`asset-server.ts`) — holds an injected `AssetSource`. `load<T>(path)` returns a
  `Handle<T>` **synchronously** via `reserveHandle()`; the IO runs off-schedule as a promise; a
  completion queue holds resolved values until the drain runs (ADR-0055 §3).
- The load-drain system (`load-drain.ts`) — runs in `PreUpdate` (main world), moves completed loads
  into their `Assets<T>` store and emits `AssetEvent.Added`. Ordered to run **before**
  `RenderSet.Extract` so a load completed this frame is visible to extraction that frame.
- `AssetPlugin` (`asset-plugin.ts`) — inserts the `AssetServer` resource and registers the drain
  system; wires the importer/serializer registries.
- `FetchAssetSource` (`fetch-source.ts`) — the one concrete source for this initiative (web `fetch`).
  Disk and bundle sources are deferred to the persistent-tier initiative.

Reuse: `Res`/`ResMut` params, the `Plugin` `build`/`ready`/`finish` lifecycle, and `MessageWriter`
for a load-failure channel if one is needed. The drain mirrors the existing extract-drain shape.

## Why deferred

Depends on `assets-core-types`. Kept separate from the retrofit so the async-load model and ordering
(`PreUpdate` drain before extract) are proven against a fresh path before the four existing types are
moved onto it — a regression here is isolated to new code.

## Acceptance

- `AssetServer.load()` returns a usable `Handle<T>` **before** its IO promise resolves; the value is
  `undefined` until the drain runs, then resolves.
- The drain populates the store and emits `Added`, and is observably ordered before
  `RenderSet.Extract` (a test asserting a same-frame load is extractable).
- A registered importer round-trips `bytes → asset`; a registered serializer round-trips
  `asset → bytes → asset`.
- The hot-reload path (re-`load`/`getMut` of an existing handle emits `Modified` behind a stable
  handle) is demonstrated by a test.
- `FetchAssetSource` reads a path through the `AssetSource` interface (mockable in test).
- `lint` / `test` / `build` green; existing engine behavior unchanged; changeset present.
