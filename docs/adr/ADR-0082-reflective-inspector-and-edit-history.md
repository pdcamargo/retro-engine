# ADR-0082: Reflective property inspector and edit history

- **Status:** Accepted
- **Date:** 2026-06-16

## Context

The studio inspector (ADR-0079) lists a selected entity's components by reflection
name but cannot edit their fields — "Phase 3" of the editor-sdk roadmap. We want a
Unity-style inspector: typed widgets per field driven by the reflection vocabulary
(ADR-0060), an extension surface for custom renderers / custom component editors /
per-field amendments, and an undo/redo history behind every edit.

Two forces shape the design. First, the reflection registry already describes every
authored component (`RegisteredType.fields`, the 17 `FieldKind`s, `FieldMeta` hints),
so the inspector should be reflection-driven and zero-config by default. Second, undo
is a first-class requirement, not a later bolt-on — so edits must not mutate the world
directly from renderers; they must flow through a boundary that a history can sit
behind without the renderers knowing.

The inspector runs in the UI overlay draw callback, outside any ECS system, so it
mutates the world synchronously (the engine `Commands` buffer is for in-system deferral
and does not apply); the history stack is the deferred/replay layer. Dear ImGui is
immediate-mode, so a drag reports a new value every frame — coalescing a scrub into one
undo entry requires the `IsItemActivated`/`IsItemDeactivatedAfterEdit` edges the binding
exposes.

## Decision

Two layers in `packages/editor-sdk`, joined by one boundary:

- **Render side (`inspector/`).** A `renderPropertyField` dispatcher resolves a renderer
  for each field — most specific first: per-(component, field) renderer → widget renderer
  (`FieldMeta.widget` or amendment) → nested-type renderer → `FieldKind` default →
  fallback — then recurses into container kinds via `ctx.renderChild`. Baseline renderers
  cover every kind. A whole-component `ComponentEditor` may override the default field
  walk (Unity `CustomEditor`); `defaultComponentEditor` walks `RegisteredType.fields`.
  Editor-side `FieldAmendment`s (read-only / disabled / hidden / relabel / force-widget)
  merge with shipped `FieldMeta` into one `ResolvedFieldMeta` the renderer reads — the
  single seam future decorator sugar records into. Read-only propagates downward through
  the dispatcher and only ever tightens (derived component, `.skip()` field, amendment,
  or a global mode such as play). All registrations live on `InspectorRegistry`, owned by
  the engine-agnostic `Editor` shell as `editor.inspector`; a component key may be a
  constructor or its stable reflection name. With nothing registered, every component
  renders fully through the seeded baseline renderers.

- **Write side (`edit/`).** Renderers report through an opaque `EditEmitter`: `scalar(path,
  current)` returns a `ScalarEdit` whose `preview`/`commit`/`sync(itemEdges)` distinguish a
  live-applied continuous scrub (one undo entry on interaction end) from an atomic edit
  (one entry immediately). Edits are plain-data `EditCommand`s (`setField` / `addComponent`
  / `removeComponent` / `custom`) interpreted by a central applier, so the ECS-mutation
  contract — write a fresh deep clone to a nested leaf, preserve the component root identity,
  `markChanged` — lives in one place and commands stay inspectable. `History` owns the
  interaction lifecycle (capture before-value on first change, coalesce the scrub, push one
  entry on `IsItemDeactivatedAfterEdit`), the past/future stacks, capacity, and batches.
  Snapshots are deep, by-value, and shape-driven (`Float32Array` vectors are copied, never
  aliased). `History` is studio-owned because it binds to a live world; the SDK ships the
  class. `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` and the Edit menu drive it.

The `EditEmitter` is the seam: a `createDirectEmitter` (apply, no history) and a
`createHistoryEmitter` (coalescing, undoable) satisfy it identically, so renderers are
written once against the boundary regardless of what sits behind it.

## Consequences

- A component gains a working, undoable editor the moment it has a reflection schema —
  no per-component UI code. Custom renderers, custom editors, and amendments are opt-in
  overrides layered on that default, registered through one discoverable surface.
- Undo correctness is centralized: one applier, one clone policy, one coalescing rule.
  Renderers cannot corrupt history because they never touch the world or the stack.
- The boundary cost: every renderer goes through `EditEmitter` rather than mutating
  directly. This is deliberate — it is what makes undo and future edit-journaling free.
- Read-only-only kinds for now: entity references, asset handles, and `mat4` render
  read-only (no pickers/matrix editor yet); the registry makes adding real editors a
  no-churn follow-up. Array add/remove and component add/remove exist in the command IR
  but are not yet wired to UI buttons.
- A dedicated history-panel UI and a TC39-decorator amendment layer are deferred
  (tracked in backlog); the `amend` API is the stable seam the latter will record into.

## Implementation

- `packages/editor-sdk/src/edit/field-path.ts` — `FieldPath`, `FieldPathSegment`, `pathKeyOf`, `readPath`, `writePathLeaf`
- `packages/editor-sdk/src/edit/command.ts` — `EditCommand` and its arms
- `packages/editor-sdk/src/edit/clone.ts` — `snapshotValue`, `snapshotComponent`, `valueEquals`
- `packages/editor-sdk/src/edit/apply.ts` — `EditTarget`, `applyEdit`, `revertEdit`, `writeFieldLive`
- `packages/editor-sdk/src/edit/emitter.ts` — `EditEmitter`, `ScalarEdit`, `ItemEdges`, `createDirectEmitter`
- `packages/editor-sdk/src/edit/history.ts` — `History`, `HistoryOptions`, `HistoryEntrySummary`
- `packages/editor-sdk/src/edit/emitter-history.ts` — `createHistoryEmitter`
- `packages/editor-sdk/src/inspector/property-types.ts` — `PropertyContext`, `PropertyRenderer`, `ChildRequest`
- `packages/editor-sdk/src/inspector/amendments.ts` — `FieldAmendment`, `ResolvedFieldMeta`, `resolveMeta`, `humanize`
- `packages/editor-sdk/src/inspector/inspector-registry.ts` — `InspectorRegistry`, `ComponentKey`, `createInspectorRegistry`
- `packages/editor-sdk/src/inspector/property-field.ts` — `renderPropertyField`, `PropertyFieldRequest`
- `packages/editor-sdk/src/inspector/renderers-*.ts` — baseline renderers (`renderers-scalar`, `-vector`, `-reference`, `-container`, `-default`, `-bridge`, `-support`) and `renderers-quat` (the `'euler'` and `'angle2d'` quaternion widget renderers). `renderers-support` also owns the per-group label-column sizing (`labelColumnWidth` / `propertyRow`) so a component's field labels align and never overlap their controls; a nullish field renders read-only as `(unset)`.
- `packages/editor-sdk/src/inspector/component-editor.ts` — `ComponentEditor`, `ComponentEditorContext`, `defaultComponentEditor`
- `packages/editor-sdk/src/inspector/inspector-body.ts` — `renderComponentBody`, `RenderComponentBodyRequest`
- `packages/editor-sdk/src/ui.ts` — `isItemActivated`, `isItemDeactivatedAfterEdit`, `isItemEdited`, `itemEdges`, `withDisabled`
- `packages/editor-sdk/src/editor.ts` — `Editor.inspector`
- `apps/studio/src/panels-inspector.ts`, `apps/studio/src/main.ts`, `apps/studio/src/shortcuts.ts` (`handleHistoryShortcuts`), `apps/studio/src/chrome.ts` — studio wiring
