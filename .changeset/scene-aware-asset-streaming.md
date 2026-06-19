---
'@retro-engine/reflect': minor
'@retro-engine/engine': minor
---

feat(engine): scene-aware selective asset streaming

Per ADR-0100, a scene now loads only the assets it references — on demand as it
decodes — instead of a whole-manifest preload, and a scene swap releases the
assets the outgoing scene held that the incoming one does not.

**`@retro-engine/reflect`:**

- `collectHandleRefs` / `collectComponentHandleRefs` + the `HandleRef` type — a
  resolver-free walker that enumerates the `{ assetType, guid }` of every `handle`
  field in serialized data without decoding it. Mirrors `decodeValue`'s structural
  recursion (array, tuple, struct, nested `type`, variant). Pure reflect
  infrastructure: no new field-type vocabulary, no component registration.

**`@retro-engine/engine`:**

- `collectSceneHandleRefs(registry, sceneData)` — walks a whole scene (entity
  components, resources, template overrides, nested scene refs) into a
  de-duplicated `HandleRef[]`.
- `spawnScene`'s default handle resolver now loads on demand: it prefers
  `AssetServer.loadByGuid` (reserves the handle immediately, streams the value in,
  idempotent) for any GUID the server can resolve, falling back to the App's
  populated `AssetStores` for assets added directly. Only the assets a scene
  references load. Backward-compatible — callers that still bulk-preload keep
  working (`loadByGuid` is idempotent).
- `AssetServer.hasGuid(guid)` — whether the server can resolve a GUID (in the
  manifest or already loading).
- `AssetServer.unloadByGuid(guid)` — drop an asset from its store (queuing its
  `removed` event) and forget its handle, so a later load re-reads it.
- `unloadUnusedAssets(server, registry, outgoing, incoming)` — the unload half of
  a scene swap: a stateless set-diff that releases the outgoing-only assets while
  the incoming delta loads on demand and shared assets stay resident.
