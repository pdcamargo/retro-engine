# ADR-0100: Scene-aware selective asset streaming

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

ADR-0066 shipped the read half of the persistent asset tier (a loadable manifest +
`AssetServer.loadByGuid`), but its coordination was deliberately coarse: a caller preloaded
the **whole** manifest, then `settle()` + drain + `spawnScene`. The desired end state
(`docs/backlog/scene-aware-asset-streaming.md`) is to load only what a scene references,
stream deltas when scenes swap, and release what is no longer needed — so scene-load cost
scales with the scene, not the project.

The blocker was a chicken/egg: discovering a scene's asset references meant decoding it, and
decoding handles needs a resolver, which needs the assets loaded. No way existed to enumerate
a serialized scene's handle refs *without* decoding.

## Decision

- **A resolver-free handle-ref walker in `reflect`.** `collectHandleRefs` /
  `collectComponentHandleRefs` mirror `decodeValue`'s structural recursion (array, tuple,
  struct, nested `type`, variant) but emit a `HandleRef { assetType, guid }` for each `handle`
  field instead of resolving it. This breaks the chicken/egg: a scene's dependencies are
  discoverable from its serialized JSON alone.
- **`collectSceneHandleRefs(registry, sceneData)`** walks a whole scene — every entity's
  components, scene resources, template overrides, and nested `SerializedSceneRef` (→
  `{ assetType: 'Scene', guid }`) — de-duplicated. Template *params* are not walked (their
  schemas are not reflected); overrides are.
- **Selective load is the default resolver, not a bulk preload.** `spawnScene`'s default
  handle resolver now prefers `AssetServer.loadByGuid` (which reserves the handle immediately,
  streams the value in, and is idempotent) for any GUID the server can resolve
  (`AssetServer.hasGuid`: in the manifest or already loading), falling back to the App's
  populated `AssetStores` for assets added directly with no manifest. So only the assets a
  scene actually references load, and they load on demand as the scene decodes — mirroring how
  nested scene refs already loaded. The whole-manifest preload is gone.
- **`AssetServer.unloadByGuid`** removes an asset from its store (queuing the `removed` event
  that releases GPU resources) and forgets its handle so a later load re-reads it.
- **Scene swap is a stateless set-diff.** `unloadUnusedAssets(server, registry, outgoing,
  incoming)` releases the assets the outgoing scene held that the incoming one does not
  reference; the incoming scene's missing assets load on demand as it spawns, and shared
  assets stay resident (they are in the incoming ref set, so never released). No refcount or
  per-instance resident-set is needed for the studio's one-scene-at-a-time model — the diff is
  computed directly from the two scenes' ref sets.

## Consequences

- A scene loads only its referenced assets; swapping scenes loads the incoming delta on demand
  and releases the outgoing-only set — both off the synchronous path. The handle-ref scan and
  swap-diff cost scale with the scene's reference count, not the project's asset count
  (`packages/engine/bench/scene-streaming.bench.ts`).
- The walker is reflect infrastructure — it adds no field-type vocabulary and registers no
  component, so CLAUDE.md §13 is untouched.
- Backward-compatible: callers that still bulk-preload (the playground's disk round-trip
  verification) keep working, since `loadByGuid` is idempotent and the resolver returns the
  already-loaded handle. Scenes with no handle fields (e.g. the current sample) are unaffected.
- A migration that *adds* a handle field is not seen by the static scan (it walks the current
  schema over raw data); such a ref resolves lazily on first decode through the same
  load-on-demand resolver, so nothing breaks.
- Refcounting across multiple simultaneously-resident scenes sharing assets, and automatic
  release on an arbitrary (non-swap) `SceneRoot` despawn, are deferred — the set-diff swap
  covers the studio's model.

## Implementation

- `packages/reflect/src/codec.ts` — `HandleRef`, `collectHandleRefs`, `collectComponentHandleRefs`
- `packages/reflect/src/index.ts` — exports
- `packages/engine/src/scene/scene-streaming.ts` — `collectSceneHandleRefs`, `unloadUnusedAssets`
- `packages/engine/src/asset/asset-server.ts` — `hasGuid`, `unloadByGuid`
- `packages/engine/src/scene/spawn.ts` — load-on-demand default handle resolver
- `packages/engine/src/index.ts` — exports
- `packages/reflect/src/collect-handle-refs.test.ts`, `packages/engine/src/scene/scene-streaming.test.ts`
- `packages/engine/bench/scene-streaming.bench.ts`
