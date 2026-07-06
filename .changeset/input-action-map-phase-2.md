---
'@retro-engine/input': minor
---

feat(input): Phase 2 — action map (`ActionMap` / `ActionState`)

Per ADR-0145, a component-based action layer over the raw device input, mirroring Bevy's `leafwing-input-manager`. Bind named actions to physical inputs, read resolved per-action state by name, rebind at runtime, and round-trip the bindings through a saved scene.

**New public surface:**

- `ActionMap` — authored component (reflection schema, serialized) holding `ActionDef[]`, with a fluent builder: `.button(name, ...sources)`, `.axis(name, { negative, positive })`, `.axis2d(name, { left, right, up, down })`. Declares `static requires = [ActionState]`.
- `ActionState` — derived component (auto-attached, **not** serialized) exposing `pressed` / `justPressed` / `justReleased` / `value` / `axis` / `axis2d` per action name. Edge state is computed against the previous frame, so many-to-many bindings resolve correctly.
- `ActionBinding`, `ActionDef` — serializable value types (registered via `registerType`); `key(code)` / `mouseButton(button)` source helpers; `InputDevice` / `BindingRole` / `ActionKind` / `ActionSource` / `Axis2dValue` types.
- `resolveActionState` — pure per-frame resolver (button = any trigger held; `axis` = positiveX − negativeX; `axis2d` = a virtual D-pad into `{ x, y }`).

`InputPlugin` now registers the schemas and runs an `action-update` system in `preUpdate` (after the raw device update) that resolves every `(ActionMap, ActionState)` entity. Composite axes are raw button sums (unit-normalized diagonals + true analog gamepad axes come in Phase 3).
