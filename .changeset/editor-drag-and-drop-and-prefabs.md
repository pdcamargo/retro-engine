---
'@retro-engine/editor-sdk': minor
'@retro-engine/editor-mcp': minor
'@retro-engine/engine': minor
---

feat(editor): general drag-and-drop pattern + Prefab asset kind

Per ADR-0136, adds one reusable drag-and-drop primitive to the EditorSDK and the
engine/editor support that lets the studio wire it to prefabs, asset fields, the
hierarchy, and the scene view.

**`@retro-engine/editor-sdk`:**

- `ui.dragSource(payload, options?)` / `ui.dropTarget({ accepts, onDrop, highlight? })` — mark the last-submitted item as a drag source or drop target. Built on ImGui's native drag-drop with a JS-side channel (`dragContext`) for the rich payload, so targets draw their own accept (green) / reject (red) highlight from the `accepts` predicate and deliver on release. The payload union is open for custom drag kinds.
- New exports: `DragPayload`, `EntityDragPayload`, `AssetDragPayload`, `DragContext`, `dragContext`, `DND_TYPE`, `DragSourceOptions`, `DropTargetOptions`, `ItemDnd`, `applyItemDnd`.
- `treeItem` gained `accent`, `suffix`, `overridden`, and `recessed` options so a row can render an instance/model tone, a faint source filename, an "edited from source" dot, and a recessed (inherited) style. `RetroPalette` gained `prefab` / `scene` / `model` accent tones.

**`@retro-engine/engine`:**

- `serializePrefab(app, root, opts?)` — serialize a single entity subtree into `SceneData` for a reusable prefab: walks `Children` from `root`, drops the root's `Parent` edge, and omits App resources (a prefab is an object, not a world).
- A distinct **Prefab** asset kind (`PREFAB_ASSET_KIND` = `'Prefab'`, `PREFAB_ASSET_EXTENSION` = `'prefab'`) registered by `ScenePlugin` against the existing `Scenes` store via `registerLoaderByKind`. A prefab loads and mounts through the same `SceneRoot` path as a scene (linked instance), distinguished only by its kind — so scene-only and prefab-only behaviour can diverge later with no asset migration.
- `hasCompositionOverrides(app, mount)` — whether a `SceneRoot`/instance entity currently differs from the source it was instantiated from (the same diff `serializeScene` records as overrides), surfaced for editor affordances.

**`@retro-engine/editor-mcp`:**

- New commands `prefab.createFromEntity`, `asset.instantiate` (kind-generic: scene/prefab → `SceneRoot`, glTF → `GltfSceneRoot`, mesh → `Mesh3d` + default material), and `material.apply` — all undoable through editor `History` and recorded in the audit ring. `asset.instantiate`'s undo despawns the whole instantiated subtree (root + reactor-spawned children), not just the root. `prefab.createFromEntity` names the file after the source entity (deduped with ` (1)`, ` (2)`, …) instead of the GUID.
- `CommandContext.reindexAssets` — optional studio-provided rescan so a just-written asset is discoverable.
- `StudioBridge.run(name, args)` — invoke a command locally (e.g. from a UI drop) on the same history/audit path as a remote MCP invoke.
