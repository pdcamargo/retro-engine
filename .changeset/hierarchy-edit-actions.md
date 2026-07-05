---
'@retro-engine/editor-sdk': minor
'@retro-engine/editor-mcp': minor
---

feat(editor): hierarchy edit actions — inline rename/create, duplicate, recursive delete, drag-to-reparent

Fills out the studio hierarchy's editing surface, backed by editor commands so a
context-menu click, a keyboard shortcut, and an AI invocation share one undoable
implementation.

**`@retro-engine/editor-mcp`:**

- `entity.duplicate` — deep-copy an entity and its whole subtree under the same
  parent with a deduped `"<name> (n)"` name; the copy is selected. Undoable.
- `entity.despawnRecursive` — delete an entity and every descendant; undo restores
  the subtree with its original entity ids (the existing single-entity
  `entity.despawn` orphaned descendants on undo).
- `entity.spawn` gains an optional `parent` so a new entity can be created directly
  under another in one atomic, undoable step.
- `despawnSubtree(world, root)` is now exported from the prefab commands.

**`@retro-engine/editor-sdk`:**

- `Widgets.treeItem` gains an `editing` option (a focused inline name field that
  replaces the label, reporting commit/cancel like `assetCard`) and an
  `onContextMenu` hook (bound to the row's selectable so a right-click menu anchors
  correctly). New `TreeItemEditing` / `TreeItemEdit` types; `TreeItemResult` gains
  an optional `edit`.
