# Undo/redo for asset file operations (create / rename / delete)

The asset browser can create, rename, and delete assets on disk (file + `.meta`
sidecar), driven from the context menu, the inline card, keyboard shortcuts, and the
MCP `asset.create` / `asset.rename` / `asset.delete` commands. These run immediately
and are recorded in the MCP audit ring, but they are **not** on the editor's
undo/redo stack — `Ctrl+Z` does not revert them.

This is deliberate for the first cut, and mirrors `scene.save`, which also is not
undoable: the `History` stack (`packages/editor-sdk/src/edit/history.ts`) is built
around world- and asset-field edits (`setField` / `addComponent` / …) applied to a
live `World`. File-level create/rename/delete need a different mechanism.

## What a proper implementation needs

- A new `EditCommand` variant (a "file op") whose apply/revert perform filesystem
  work rather than mutating the world:
  - **create** → undo deletes the file + sidecar and unloads the GUID; redo rewrites them.
  - **rename** → undo renames both files back; redo renames forward.
  - **delete** → capture the file + sidecar bytes before deleting so undo can rewrite
    them (and re-insert the store slot); redo deletes again.
- Route each op through `History` (so it groups/labels like other edits) while still
  arming the watcher-reindex suppression window and reindexing after apply/revert.
- Decide how a delete's undo restores references that were repointed/dropped, if any.

## Why deferred

It is a distinct subsystem from the field-edit history and larger than the slice that
shipped the create/rename/delete UX. Tracked here so the gap is explicit, not silent
(CLAUDE.md §14 expects mutating commands to be undoable where it makes sense).
