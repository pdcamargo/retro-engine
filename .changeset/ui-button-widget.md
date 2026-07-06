---
'@retro-engine/ui': minor
---

feat(ui): UiButton widget + Disabled state (UI phase 4b)

Ergonomic buttons on top of the interaction layer — enough to build a menu.

- `UiButton` — a button's background palette (`normal`/`hovered`/`pressed`/
  `disabled`); a built-in `UiInteractionPlugin` system drives the node's
  `backgroundColor` from it by the node's `UiInteraction` state, so games no
  longer hand-write hover/press tinting. Requires the `Interactable` machinery
  (and thus a `UiNode`). Reflection-registered.
- `Disabled` — an authored marker; picking ignores it (no hover/press/click) and
  `UiButton` shows the disabled color. Reflection-registered.
- `setUiBackground(node, color)` — the supported way to recolor a node at runtime
  (the resolved `UiStyle` is otherwise read-only).
- `pickTopmost` / `updateUiInteraction` now skip `disabled` entries.

Verified end-to-end: the `sample-game` export renders a centered 3-button main
menu (NEW GAME / LOAD [disabled] / QUIT) with built-in button styling; clicking
an enabled button routes its `MenuAction` to a "LAST: …" label, and the disabled
button is inert — driven through the real input backend in a browser (Playwright).
74 UI tests. Widget set (label/toggle/slider/…) + focus/spatial nav still to come.
