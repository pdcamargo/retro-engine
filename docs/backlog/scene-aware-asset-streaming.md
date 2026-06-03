# Scene-aware asset streaming

- **Created:** 2026-06-03

## Context

ADR-0066 shipped the read half of the persistent asset tier: a loadable manifest + `AssetServer.loadByGuid`, so a fresh App resolves a saved scene's handles over the injected source. The coordination it shipped is deliberately coarse — the caller preloads the **whole** manifest, then `settle()` + drain + `spawnScene`. That is correct but not performance-minded.

The desired end state (project direction): load only what a scene references, stream deltas when scenes swap, and release what is no longer needed — so scene-load speed and memory scale with the scene, not the project.

## Why deferred

The read-path slice was scoped to proving cross-process GUID resolution end-to-end. The optimizations below each pull in machinery bigger than that slice:

- **Selective load** needs a reflection schema walker to collect a `SceneData`'s handle refs (assetType + GUID) **without decoding** — decoding requires a working resolver, which is the chicken/egg the load is trying to satisfy. No such walker exists today (reflect's `decodeValue` / `decodeComponent` only resolve handles, they don't enumerate them), so it would be new reflect surface to build and test.
- **Background streaming + unload** needs a scene-swap lifecycle: diff the incoming scene's asset set against the resident set, load the delta off the frame path, and release the assets the outgoing scene held (respecting assets the incoming scene still references). That touches store lifetime and the SceneRoot reactor.

## Acceptance

- Loading a scene loads **only** the assets it references (handle-ref scan), not the whole manifest.
- Swapping scenes background-loads the new scene's missing assets (skipping those already resident) and unloads assets the previous scene held that the new one does not — without stalling the frame.
- `SceneRoot` resolves its own referenced assets: the reactor (which already waits for the `Scene` asset) waits for the referenced assets too, so a caller spawns a scene without hand-sequencing `loadByGuid → settle → drain → spawn`.
- Measured: scene-swap asset work does not regress frame time on the active path; load time scales with the scene's asset set, not the project's.
