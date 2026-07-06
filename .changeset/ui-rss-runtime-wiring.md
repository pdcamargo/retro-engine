---
'@retro-engine/ui': minor
---

feat(ui): `.rss` runtime style wiring — apply a parsed stylesheet to the live UI tree

The `.rss` (USS-subset) parser + cascade already existed; this wires it into the
running UI so a stylesheet actually styles nodes each frame ("Retro CSS").

- `resolveUiStyle` now maps the **paint** properties too — `background-color`,
  `border-color`, `border-width`, and the `border` shorthand — via a new
  `parseColor` (hex `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, `rgb()`/`rgba()`, and
  named colors → an RGBA `Vec4` in `[0,1]`, stored as authored, matching a
  hand-set `UiStyle.backgroundColor`).
- New `UiStyleSheet` resource holds the active parsed rules; `setUiStyleSheet(app,
  rss)` parses and installs them.
- New `UiClass` component (reflection-registered: `classes` / `name` / `type`)
  gives a node its selector identity. Nodes carrying one are styled from the sheet.
- `UiPlugin` runs a `postUpdate` `'ui-style'` system (before `'ui-layout'`) that
  resolves each `UiClass` node's `UiStyle` from the sheet every frame, deriving
  pseudo-class states — `hovered`/`pressed` from `UiInteraction`, `disabled` from
  the `Disabled` marker — so hover/press/disable reflow the same frame.

Additive: nodes without a `UiClass` keep their authored `UiNode.style` untouched.
Bench added (`rss-style`). Verified in a real browser via the sample-game export:
`.chip` → blue, `.chip.alt` (compound) → orange, `.chip:hovered` → red on live hover.
