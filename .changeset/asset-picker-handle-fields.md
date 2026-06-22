---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): asset field widget + handle-field editing surface

Per ADR-0110, adds the inspector surface for editing `t.handle(...)` (asset handle) properties, which the studio wires into an asset picker.

**New public surface:**

- `Widgets.assetField(id, options)` / `AssetFieldOptions` — an input-like asset slot (à la Unity's object field): a swatch (thumbnail or type icon), the assigned asset's name (or a muted "None"), a type tag, and a target affordance. It only reports clicks, so assignment stays decoupled from the click-to-open flow.
- `PropertyContext.componentName` — the owning registered type's stable name, for renderers that label cross-cutting UI.
- `propertyRow`, `labeledRow`, `labelColumnWidth` re-exported for custom renderers laying out a labeled inspector row.

**Behaviour change:**

- The property dispatcher no longer short-circuits a nullish value to a read-only `(unset)` row for `kind === 'handle'` — a reference renderer is dispatched even when the slot is empty, so it can draw an "assign" affordance. Other kinds keep the `(unset)` / `(null)` fallback.
