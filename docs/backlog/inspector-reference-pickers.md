# Inspector — reference pickers and structural edits

The reflective inspector (ADR-0082) ships read-only renderers for the reference and
matrix kinds, and no UI for structural edits. Follow-ups, each a no-churn addition
behind the existing registry/command seams:

- **Entity reference picker** (`entity` kind) — pick a target entity (drag-from-
  hierarchy or a searchable dropdown) instead of showing the raw id.
- **Asset handle picker** (`handle` kind) — pick an asset from the store named by
  `FieldType.assetType` instead of showing `"<store> handle"`.
- **`mat4` editing** — currently a read-only value grid; decide whether direct matrix
  editing is ever wanted (likely stays read-only / decomposed).
- **Array add/remove + reorder** — the `array` renderer lists elements but has no
  add/remove/reorder controls; emit whole-array values through the existing emitter.
- **Component add/remove buttons** — `AddComponentCommand`/`RemoveComponentCommand`
  exist in the IR and applier but are not wired to inspector/menu buttons yet.
- **Setting an unset optional/nullable field** — a `null`/`undefined` field renders
  read-only as `(unset)`/`(null)` (can't feed a typed widget a nullish value);
  needs an "enable" affordance that seeds a default value before editing.
