# Editor asset editing — inspector edits assets, not just entities

- **Created:** 2026-06-27
- **Status:** In progress — Slice 1 next
- **Decision:** [ADR-0135](../adr/ADR-0135-editor-asset-editing.md)

## Goal

Select an asset (starting with a material), edit its reflected fields in the
inspector — including assigning textures to its `Handle<Image>` slots — see every
entity using it update live, and have the change persist to the asset's `.remat`.
Undoable, audited, MCP-driveable, and exposed as public `editor-sdk` API so users
can register their own asset editors. Proves out on the gray Synty character
(assign its atlas via the UI) and sets up RetroHuman skin/eyes/hair.

## Slices

Each slice keeps the gate green (lint/typecheck/test/build/bench) and behaviour
verified before advancing.

- **1 — Scoped edit foundation (editor-sdk).** `EditScope` (entity | asset);
  `SetFieldCommand` carries a scope; `applyEdit`/`revertEdit` route field writes
  to the world or an asset store; `EditTarget` asset port; `History` keyed on
  scope (entity call sites kept via wrappers); `createAssetHistoryEmitter`.
  Unit-tested. No UI yet.
- **2 — Single-asset serialization (engine) + asset edit access (editor-sdk/studio).**
  `saveAsset(app, handle, location, sink)` helper; the studio's `EditTarget`
  asset port reads/mutates asset stores by guid (`getMut` → live rebuild) and
  marks dirty; debounced autosave to the asset's manifest location.
- **3 — Generalized selection.** `EditorSelection` (entity | asset); asset
  browser sets the asset case; hierarchy keeps the entity case; back-compat for
  existing `selectedEntity` readers.
- **4 — Asset-editor registry + inspector dispatch + material editor.**
  `AssetEditorRegistry` (editor-sdk); inspector branches on selection kind;
  default reflection-walk editor renders a material's fields (texture slots reuse
  the asset-picker). Verify: select a material → edit a field / assign a texture →
  entities update live → saved + undoable.
- **5 — Extract editable copy.** Editing a derived (glb) material mints a new
  `.remat` + repoints the `MeshMaterial3d` (undoable). Verify on the Synty
  character: extract → assign atlas → persists across reload.
- **6 — MCP asset commands.** `asset.get` / `asset.setField` / `asset.save`
  through the generalized History. Verify via the retro-studio MCP.

## Open questions

- **Debounce vs explicit save** for asset edits — autosave-on-idle vs a dirty
  marker + explicit save. Start with debounced autosave; revisit if it churns disk.
- **Per-entity material override** (so two meshes can diverge from a shared
  material) — out of scope here; a material edit affects all users by design.

## Links

- ADR-0135 (this initiative), ADR-0109 (studio MCP), ADR-0111/0055/0089 (assets),
  ADR-0060/0061 (reflection/serialization)
- `docs/bugs/obj-base-mesh-normal-uv-attribute-order.md`,
  `docs/bugs/malformed-material-uniform-breaks-render-loop.md` (found during the
  texturing investigation that motivated this)
