---
'@retro-engine/editor-sdk': minor
'@retro-engine/editor-mcp': minor
'@retro-engine/engine': minor
---

feat(editor-sdk): asset context-action registry + inline create/rename, and asset lifecycle plumbing

Adds an extensible pattern for asset-browser context-menu actions and the create/rename/delete flows built on it.

**`@retro-engine/editor-sdk`:**

- `AssetActionRegistry` (+ `createAssetActionRegistry`) and the `AssetAction` / `AssetActionContext` / `AssetActionHost` / `AssetActionTarget` / `AssetDraft` types — register actions scoped to a specific asset type/kind, all assets, or the panel (create actions). Exposed as `Editor.assetActions`.
- `MenuEntry.submenu` (nested menus) and an exported `renderMenuEntries` shared by context menus and the menu bar.
- `Widgets.contextMenuWindow` — a background context menu (opens on empty space, defers to per-item menus).
- `assetCard` gained an inline editing mode (`AssetCardEditing`) for create/rename, plus `icon` / `tag` / `tone` overrides so kinds sharing one browser bucket read distinctly.
- `Keys.Enter` and `Keys.F2`.

**`@retro-engine/engine`:**

- `AssetServer.loadErrorForGuid(guid)` — the sticky error from a failed load, so tooling can distinguish "failed" from "still loading".

**`@retro-engine/editor-mcp`:**

- `asset.create` / `asset.rename` / `asset.delete` commands, backed by new optional `CommandContext` hooks (`createAsset` / `renameAsset` / `deleteAsset`).
