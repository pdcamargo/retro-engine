---
'@retro-engine/editor-mcp': minor
'@retro-engine/engine': minor
---

feat(mcp): asset.get / asset.setField / asset.save

AI-driveable asset editing, mirroring the `component.*` commands but for a stored
asset value (e.g. a material):

- `asset.get` — an asset's serialized fields by GUID + kind (loads it if needed).
- `asset.setField` — set one field; decoded into the field type (texture slots take
  an image GUID), routed through the scoped `History` (undoable + audited) and
  autosaved to the asset file.
- `asset.save` — force an immediate write to the asset's project file.

Adds `AssetServer.locationForGuid` (the manifest path for a GUID) so a save can
resolve the target file. Verified live: `asset.setField roughness` persisted to the
`.remat`, `history.undo` reverted + re-saved it, `asset.save` wrote on demand.
