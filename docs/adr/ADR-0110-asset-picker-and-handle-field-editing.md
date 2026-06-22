# ADR-0110: Asset picker and handle-field editing in the inspector

- **Status:** Accepted
- **Date:** 2026-06-22

## Context

The studio inspector edits primitive component properties (numbers, vectors, colors, enums, booleans) through the reflective property dispatcher (ADR-0060/0061), but `t.handle(...)` fields had no editing UI: the baseline `handleRenderer` showed an asset handle read-only, and the dispatcher short-circuited any nullish value to a dead `(unset)` row before a renderer could draw an "assign" affordance. So no handle property — `Sprite.image`, `Mesh3d.handle`, `TextureAtlas.layout`, material textures — could be assigned from the editor.

Three facts shaped the design:

- The studio is immediate-mode ImGui, so the picker is hand-drawn (modeled on the Entity Composer modal), not a retained-DOM component.
- A handle's expected store is the schema's `t.handle(assetType)` name (`'Image'`, `'Mesh'`, a material store name); the project browser already enumerates assets by GUID with thumbnails, and `AssetServer.loadByGuid` resolves a GUID to a live handle.
- The picker confirms on a later frame than the click that opened it, so the write path must survive across frames without holding per-frame ImGui state.

## Decision

Add an asset picker modal and an input-like asset field, wired to every handle property through one kind-renderer registration.

- **Reference kinds own their empty state.** The dispatcher no longer short-circuits a nullish value for `kind === 'handle'`; the handle renderer draws an "assign" slot whether or not the field is set. Other kinds keep the read-only `(unset)` fallback.
- **`PropertyContext` carries `componentName`** (the owning registered type's stable name) so a renderer can label cross-cutting UI without parsing the widget id.
- **A reusable `assetField` widget** (editor-sdk, studio-agnostic) renders the Unity-style object slot: swatch (thumbnail or type icon), name (or muted "None"), type tag, target affordance. It only reports clicks; assignment is decoupled from the click-to-open flow so a future drag-and-drop can assign the same way.
- **The studio registers a `'handle'` kind renderer** that draws `assetField` and, on click, opens the picker with the slot's expected store, current GUID, clearability (optional/nullable), context labels, and a **commit closure captured over the field's `EditEmitter`** — `(h) => ctx.edit.scalar(path, current).commit(h)`. The history emitter is a stateless facade over `(history, entity, componentName)`, so the closure stays valid across frames.
- **The picker modal** (studio) reads the live project browser for the assignable pool + thumbnails, scopes the folder tree / type chips to compatible types, and on Assign resolves the GUID to a handle via `AssetServer.loadByGuid` and calls the commit closure; on None it commits `undefined` (clearable slots only). Single-select, modal layout.

## Consequences

- Every `t.handle(...)` field becomes editable and undoable with no per-component wiring; new handle fields get the picker for free.
- Assignment routes through the same `EditEmitter` the inspector uses, so it works for both the live world (history-backed) and detached drafts (instance-backed), and undo/redo is automatic.
- The picker is the GUI counterpart to the existing `component.set` MCP path (which already assigns handles by GUID), so no new MCP command is needed.
- Deferred, tracked in backlog: the compact popover layout, multi-select (no engine component has an array-of-handles field yet), asset tags (not in the manifest), and per-project persistence of favorites/recents. Image dimensions in the preview are read from the thumbnail decode; mesh/material show their kind string.
- A small SDK surface grew (`assetField`, `PropertyContext.componentName`, exported `propertyRow`/`labeledRow`/`labelColumnWidth`), and the dispatcher's nullish rule now branches on kind.

## Implementation

- `packages/editor-sdk/src/inspector/property-field.ts` — nullish short-circuit exempts `kind === 'handle'`; `ctx.componentName` populated
- `packages/editor-sdk/src/inspector/property-types.ts` — `PropertyContext.componentName`
- `packages/editor-sdk/src/components-asset-field.ts` — `assetField`, `AssetFieldOptions`
- `packages/editor-sdk/src/components.ts` — `Widgets.assetField`
- `packages/editor-sdk/src/index.ts` — `assetField` types, `propertyRow` / `labeledRow` / `labelColumnWidth` exports
- `apps/studio/src/inspector/asset-field-renderer.ts` — `makeAssetFieldRenderer` (registered as the `'handle'` kind renderer in `apps/studio/src/main.ts`)
- `apps/studio/src/asset-picker/asset-picker-catalog.ts` — `assetTypeSpec`, `filterAssets`, `sortAssets`, `buildFolderTree`, `presentTypes`
- `apps/studio/src/asset-picker/asset-picker-state.ts` — `AssetPickerState`, `openAssetPicker`, `closeAssetPicker`, `pushRecent`
- `apps/studio/src/asset-picker/asset-picker-modal.ts` — `assetPickerModal`
- `apps/studio/src/thumbnails/thumbnail-service.ts` — `dimensionsOf`
- `apps/studio/src/state.ts` — `StudioState.assetPicker`; `apps/studio/src/chrome.ts` — picker drawn in `drawDialogs`
