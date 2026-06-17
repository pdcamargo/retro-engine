---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): reflective property inspector + undo/redo edit history (ADR-0082)

Adds the studio's editable, reflection-driven inspector and the undo/redo pipeline behind it. Two layers joined by one boundary: a render side that turns a component's reflection schema into typed field widgets, and a write side that routes every edit through an undoable command history. With nothing registered, any component with a reflection schema renders fully and editably through baseline renderers.

**New public surface:**

- **Inspector render layer** — `renderComponentBody` / `RenderComponentBodyRequest` (per-component entry point), `renderPropertyField` / `PropertyFieldRequest` (the field dispatcher), `PropertyContext`, `PropertyRenderer`, `ChildRequest`. `InspectorRegistry` + `createInspectorRegistry` + `ComponentKey` — register custom renderers (by `FieldKind`, widget id, nested type, or exact field), whole-component `ComponentEditor`s, and per-field `FieldAmendment`s. `resolveMeta` / `ResolvedFieldMeta` / `humanize`. `defaultComponentEditor` / `ComponentEditorContext`. Bridge helpers `colorToHex` / `hexToColor` / `defaultValueFor`.
- **Edit pipeline** — `History` (`HistoryOptions`, `HistoryEntrySummary`): undo/redo with drag coalescing, capacity, and batches. `EditEmitter` / `ScalarEdit` / `ItemEdges` with `createDirectEmitter` (no history) and `createHistoryEmitter` (undoable) — the boundary renderers depend on. `EditCommand` data IR (`setField` / `addComponent` / `removeComponent` / `custom`) with `applyEdit` / `revertEdit` / `EditTarget` / `writeFieldLive`. `FieldPath` / `FieldPathSegment` / `pathKeyOf` / `readPath` / `writePathLeaf`. `snapshotValue` / `snapshotComponent` / `valueEquals`.
- **`Editor.inspector`** — the `InspectorRegistry` instance, the studio/plugin registration surface.
- **`ui` additions** — `isItemActivated`, `isItemDeactivatedAfterEdit`, `isItemEdited`, `itemEdges`, `withDisabled`.

Renderers never touch the ECS world — they emit through `EditEmitter`, so undo is correct by construction and a continuous scrub coalesces into a single entry (driven by the ImGui item-deactivation edge). Reference pickers (entity/handle), `mat4` editing, structural array/component edits, a history-panel UI, and decorator sugar are deferred (tracked in backlog).

Quaternion fields render as raw `x/y/z/w` by default, with opt-in `'euler'` (X/Y/Z degrees, matching `quat.fromEuler(…, 'xyz')`) and `'angle2d'` (a single 2D rotation about +Z) widget renderers — select per field via a schema `widget` hint or an `editor.inspector.amend(…, { widget })`. A component's field labels share one column width (the widest label + a gap) so labels align and never overlap their controls, and an unset optional/nullable field renders read-only as `(unset)`.
