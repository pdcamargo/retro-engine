# ADR-0136: Editor drag-and-drop pattern and the Prefab asset kind

- **Status:** Accepted
- **Date:** 2026-06-28

## Context

The studio had no drag-and-drop. We wanted one general, scalable, user-extensible
primitive in the EditorSDK that every panel — and third-party windows — can use,
then wire it to the editor's recurring needs: assigning an asset to an inspector
field, authoring a prefab from an entity, instantiating a prefab into the
hierarchy or the scene, and previewing where a drop will land.

Two constraints shaped the design:

1. **jsimgui only marshals a small opaque payload.** ImGui's native drag-drop
   carries a short type tag + bytes, not a rich JS object. But it owns the parts
   that are tedious to reimplement: cross-window gesture tracking, the drag
   tooltip, and delivery-on-release. `GetDragDropPayload()` can also peek the
   active payload from anywhere — which the scene-view preview needs.
2. **"Prefab" overlaps heavily with "Scene", but is not the same thing.** An
   editor-authored entity graph already serializes as a `Scene` (`.rescene`) and
   the composition system already mounts a child scene under a parent via
   `SceneRoot` — i.e. the linked-instance mechanism a prefab needs already exists
   and resolves a child purely by GUID, never inspecting its kind. However,
   `serializeScene` always captures App resources (lighting, gravity, audio), and
   a prefab — an object dropped many times — must never carry world resources.
   Scenes also own level-only semantics (the active-document binding). The two
   want to diverge later without retroactively reclassifying every `.rescene`.

## Decision

**Drag-and-drop primitive.** Build on ImGui's native drag-drop with a JS-side
channel for the rich payload. A drag source sets a single fixed ImGui payload
type (`RETRO_DND`) and publishes the typed `DragPayload` into a module-level
`dragContext`; targets read it back with `dragContext.peek()`. Two methods on the
`Ui` surface express the whole pattern: `ui.dragSource(payload, opts?)` and
`ui.dropTarget({ accepts, onDrop, highlight? })`. Targets draw their own
accept/reject highlight (green/red) from `accepts(payload)` — covering "this input
accepts it" *and* "this one doesn't" — and deliver via `AcceptDragDropPayload`
with `AcceptNoDrawDefaultRect`. The payload union is open, so consumers define
custom drag kinds.

**Prefab is a distinct asset kind that reuses the Scene machinery.** A prefab is
`kind: 'Prefab'`, extension `.prefab`, `category: 'prefab'` — registered via
`registerLoaderByKind('Prefab', scenes, …)` so it loads into the **same `Scenes`
store** and mounts through the **same `SceneRoot` path** as a scene, with zero
mount-code changes. The only format difference: a prefab is captured by
`serializePrefab` (a single entity subtree, root `Parent` dropped, **no
resources**), never `serializeScene`. Drops instantiate a **linked instance**
(`SceneRoot` referencing the asset GUID).

This draws the migration-expensive boundary (kind identity) now, so scene-only and
prefab-only features can diverge later with no asset reclassification, while
reusing all the proven serialization + composition code.

**Editor operations are commands.** `prefab.createFromEntity`,
`asset.instantiate`, and `material.apply` are `defineCommand`s in `editor-mcp`,
routed through editor `History` (undoable) and the audit ring. Studio UI drops
invoke them via `StudioMcp.run` / `StudioBridge.run`, so a drag and an AI
invocation share one implementation and one undo/audit path. `asset.instantiate`
is kind-generic: scene/prefab (`SceneRoot`), glTF model (`GltfSceneRoot`), and mesh
(`Mesh3d` + default material) all spawn the same way — it resolves the instance
component's constructor from the reflection registry by name (each takes a single
`Handle`), so it needs no per-kind package dependency. The scene-view preview and
the hierarchy/scene drop targets accept all four kinds.

## Consequences

- Any panel or third-party editor window gets drag-and-drop by calling
  `ui.dragSource` / `ui.dropTarget`; the accept/reject highlight and delivery are
  handled for it. The pattern scales to new payload kinds without touching the
  primitive.
- Prefabs cost almost nothing to add (one kind registration + one subtree
  serializer) yet are a first-class, independently-evolvable asset kind. The
  trade-off accepted: prefab and scene share a runtime store and `Scene` type
  today; if they must diverge at runtime later, the store can be split without an
  asset migration because the kind boundary already exists.
- The scene-view preview/drop uses the established split-frame pattern (capture in
  the UI pass, resolve in `postUpdate`), and derives hover from the viewport rect
  because ImGui suppresses item hover while a drag payload is active.
- The material-on-mesh preview (nice-to-have) mutates a live `MeshMaterial3d`
  handle for feedback and restores it before the undoable `material.apply` commits,
  so undo records the true prior handle.

## Implementation

- `packages/editor-sdk/src/dnd/drag-payload.ts` — `DragPayload`, `EntityDragPayload`, `AssetDragPayload`
- `packages/editor-sdk/src/dnd/drag-context.ts` — `dragContext`, `DND_TYPE`, `DragContext`
- `packages/editor-sdk/src/dnd/dnd-ui.ts` — `beginDragSource`, `handleDropTarget`, `DragSourceOptions`, `DropTargetOptions`
- `packages/editor-sdk/src/ui.ts` — `Ui.dragSource`, `Ui.dropTarget`
- `packages/engine/src/scene/serialize.ts` — `serializePrefab`
- `packages/engine/src/scene/scene-plugin.ts` — `PREFAB_ASSET_KIND`, `PREFAB_ASSET_EXTENSION`, the `Prefab` kind + kind-loader registration
- `packages/editor-mcp/src/commands/prefab.ts` — `prefab.createFromEntity`, `asset.instantiate`, `material.apply`
- `packages/editor-mcp/src/context.ts` — `CommandContext.reindexAssets`
- `packages/editor-mcp/src/bridge.ts` — `StudioBridge.run`
- `apps/studio/src/dnd-actions.ts` — `instantiatePrefab`, `createPrefabFromEntity`, `applyMaterial`, `RunCommand`
- `apps/studio/src/scene-drop.ts` — `SceneDrop` (viewport prefab preview/drop + material apply)
- `apps/studio/src/panels-left.ts`, `apps/studio/src/assets/{assets-grid,assets-panel}.ts`, `apps/studio/src/inspector/asset-field-renderer.ts` — drag sources + drop targets
