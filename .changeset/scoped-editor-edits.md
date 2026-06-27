---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): scope-generic edits (entity or asset)

Generalizes the edit/undo stack so an edit can target an entity component **or** a
stored asset value — the foundation for editing assets (materials) in the
inspector with the same undoable, audited path as entity edits.

- `EditScope` (`{kind:'entity',entity,componentName}` | `{kind:'asset',assetKind,guid}`),
  with `entityScope` / `assetScope` / `scopeKey` / `scopeLabel`.
- `SetFieldCommand` carries a `scope` instead of bare `entity` + `componentName`;
  `applyEdit` / `revertEdit` route a field write to the live world or to an asset
  store. `EditTarget` gains an optional `assets` port (`AssetEditAccess`:
  `getMut` + `markDirty`) for asset-scoped writes; `writeAssetFieldLive` /
  `writeScopedLive` are exported.
- `History` is keyed on scope (`previewScoped` / `syncScoped` / `commitScoped`);
  the existing `preview` / `sync` / `commit` (entity) keep working as wrappers, so
  the inspector and MCP `component.set` are unchanged.
- `createAssetHistoryEmitter` / `createScopedHistoryEmitter` produce
  asset-scoped emitters; renderers depend only on `EditEmitter` and are unchanged.
