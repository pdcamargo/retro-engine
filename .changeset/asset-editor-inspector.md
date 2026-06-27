---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): asset selection + asset-editor registry

The inspector can now edit a selected **asset**, not just an entity.

- `AssetSelection` (`assetType` + `guid` + `assetKind`) — the asset counterpart to
  selecting an entity.
- `AssetEditorRegistry` (on `Editor.assetEditors`, parallel to `Editor.inspector`):
  register a custom editor per asset type. An asset type with no registered editor
  falls back to the default reflection walk, so a reflected asset (e.g. a material,
  whose `Handle<Image>` texture slots render with the existing asset-picker) is
  editable with no registration. `AssetEditor` / `AssetEditorContext` describe the
  editor surface.

The studio wires this into the inspector: selecting a material shows its fields
(Base Color, Metallic, Roughness, the texture slots, …); edits route through the
scoped `History` and persist to the asset's `.remat`.
