---
'@retro-engine/engine': minor
---

feat(engine): add `createAsset` helper for minting new project assets

`createAsset(value, kind, serializer, sink, opts)` mints a fresh GUID, serializes the value through its kind serializer, and writes both the asset file and its `.meta` sidecar through the sink — the create-from-scratch complement to `promoteAsset` (which freezes an existing handle's identity). Returns `{ guid, location, bytes }`; rebuilding the manifest and filling the live store slot remain the caller's responsibility, since those depend on the live `AssetServer`. First consumer is the studio character creator, which uses it to persist a textured skin material as a reloadable `.remat` for spawned and baked RetroHuman characters.
