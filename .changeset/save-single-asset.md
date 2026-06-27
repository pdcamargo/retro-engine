---
'@retro-engine/engine': minor
---

feat(engine): saveAsset — serialize one asset to its file + AssetServer.storeForGuid

`saveAsset(app, guid, kind, location, sink)` serializes a single loaded asset
through its registered serializer and writes it via the sink at its manifest
location — the complement of the full `serializeProject` pipeline, for persisting
one edited asset (e.g. a material changed in the inspector). Returns `false`
(no-op) when the asset system is absent, the kind has no serializer, or the asset
is not loaded.

`AssetServer.storeForGuid(guid)` exposes the store + handle a loaded GUID resolves
to, so tooling can reach an asset's live value generically — needed because some
kinds (materials) register their store under a different key than their manifest
kind. `saveAsset` uses it, falling back to the kind-keyed `AssetStores` registry.
