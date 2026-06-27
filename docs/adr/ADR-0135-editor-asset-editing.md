# ADR-0135: Editor asset editing — scoped edits, asset-editor registry, serialization surface

- **Status:** Accepted
- **Date:** 2026-06-27

## Context

The studio inspector can edit a selected **entity's** components: it walks each
component's reflection schema and renders a widget per field, and every edit
flows through `History` (undo/redo + the MCP audit ring). Two things it cannot do:

1. **Edit an asset.** Selection is entity-only (`state.selectedEntity: Entity | null`),
   and the whole edit stack — `EditCommand`, `apply`/`revert`, `History`,
   `EditEmitter` — is keyed on `(entity, componentName)`. A material is an asset
   value, not an entity component, so there is no path to edit its fields
   (including its `baseColorTexture` / normal / MR / emissive slots) in the
   inspector. Today a material's texture can only be set by glTF-embedded import
   or by code.
2. **Persist a single asset.** Asset save only happens inside a full
   `serializeProject`; there is no "save this one material to its `.remat`".

This blocks the natural authoring flow: select a material → assign a texture →
see every mesh using it update → save. It also blocks a broader goal — letting
users register **their own** asset editors in their editor code, the same way the
studio registers panels and component editors.

What already works and must be reused, not rebuilt:

- The reflection field-rendering machinery (`renderComponentBody`, the per-kind
  property renderers) is agnostic to where the value comes from — it renders any
  `{ instance, registered, edit }`. `StandardMaterial` already has a registered
  schema whose texture slots are tagged as `handle` fields with `assetType: 'image'`,
  so they render with the existing asset-picker field renderer.
- Live propagation is free: `Assets.getMut(handle)` queues a `modified` event;
  the material prepare system rebuilds the bind group, and every entity holding
  that handle re-renders. No per-entity fan-out is needed.
- `.remat` serialization exists (`createMaterialSerializer`, the reflection codec;
  texture handles round-trip by GUID).

## Decision

Make editor editing **scope-generic** (entity *or* asset) end to end — undoable,
audited, and MCP-replayable from day one — and expose the asset-editing surface
as **public `@retro-engine/editor-sdk` API** so consumers can register their own
asset editors.

1. **`EditScope`.** Introduce a discriminated edit scope in editor-sdk:
   `{ kind: 'entity'; entity; componentName } | { kind: 'asset'; assetKind; guid }`.
   `SetFieldCommand` carries a `scope` instead of bare `(entity, componentName)`;
   `applyEdit`/`revertEdit` route a `setField` to the live world (entity scope) or
   to the asset store (asset scope). Add/remove-component and bundle commands stay
   entity-only (an asset is a single value, not a component bag). `EditTarget`
   gains an optional asset-access port (read an asset value by `(kind, guid)`,
   mutate it via `getMut` so the live rebuild fires, and mark it dirty for save).
   `History` keys its coalescing interaction on the scope; `commit`/`preview`/`sync`
   take a scope (the existing `(entity, componentName)` call sites keep working via
   thin entity-scope wrappers). `EditEmitter` is unchanged — renderers already
   depend only on it; an asset-bound emitter (`createAssetHistoryEmitter`) produces
   asset-scoped commands.

2. **`EditorSelection`.** Generalize selection to
   `{ kind: 'entity'; entity } | { kind: 'asset'; assetType; guid }`. The hierarchy
   sets the entity case; the asset browser sets the asset case. The inspector
   dispatches on the selection kind.

3. **`AssetEditorRegistry`** (editor-sdk, parallel to `InspectorRegistry`,
   surfaced on the `Editor`). Maps an asset type to an editor. The **default**
   editor for any reflected asset value is the existing reflection walk
   (`renderComponentBody` with an asset-scoped emitter) — so a material is editable
   with no bespoke UI, and its `Handle<Image>` slots reuse the asset-picker. A type
   may register a richer custom editor.

4. **Single-asset serialization.** Add an engine helper that serializes one asset
   through its registered serializer and writes it via the `AssetSink` at the
   asset's manifest location. Asset-scoped edits mark the asset dirty; the studio
   saves (debounced) so an inspector edit persists to the asset's `.remat`.

5. **Derived (read-only) assets.** A material derived from a glb (`<glb>#MaterialN`,
   no `.remat`) is a read-only projection of the binary. Editing it offers
   **"extract editable copy"**: mint a new `StandardMaterial` with a fresh GUID,
   write a `.remat`, and repoint the referencing `MeshMaterial3d` (an ordinary,
   undoable entity edit). The copy is then editable like any asset.

6. **MCP.** Add `asset.get` / `asset.setField` / `asset.save` commands
   (`@retro-engine/editor-mcp`, browser-safe) routed through the generalized
   `History`, so AI-driven asset edits are undoable + audited like entity edits.

## Consequences

- One edit/undo/audit path covers entities and assets; the MCP, the inspector,
  and user code all edit through the same scoped commands.
- The material editor is mostly composition: selection + registry + the existing
  reflection walk + the existing asset-picker. Texture assignment, live update,
  and `.remat` round-trip already exist.
- The `EditScope` change touches the command/apply/history/emitter core and their
  call sites (MCP `component.set`, the inspector emitter, the history panel view).
  Entity edits keep working through entity-scope wrappers, so the blast radius is
  contained to the edit module + its consumers.
- Editing a shared material affects every user of it (correct: it is one asset).
  Per-entity material overrides remain a separate, future concern.
- Derived-asset editing is deliberately a copy-on-edit, not a write-back into the
  binary — the glb stays the source of truth; user edits live in a `.remat`.

## Implementation

- `packages/editor-sdk/src/edit/` — `EditScope`, scoped `SetFieldCommand`,
  `applyEdit`/`revertEdit` asset routing, `EditTarget` asset port, scoped
  `History`, `createAssetHistoryEmitter`
- `packages/editor-sdk/src/asset-editor/` — `AssetEditorRegistry`, default
  reflection-walk editor
- `packages/editor-sdk/src/` — `EditorSelection`
- `packages/engine/src/save/` — single-asset serialize + write helper
- `apps/studio/src/` — selection wiring, inspector dispatch, asset-browser
  selection, debounced asset save, extract-editable-copy action
- `packages/editor-mcp/src/commands/asset.ts` — `asset.get` / `asset.setField` /
  `asset.save`
