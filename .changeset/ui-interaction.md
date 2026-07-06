---
'@retro-engine/ui': minor
---

feat(ui): pointer interaction — picking, hover/press state, click events (UI phase 4a)

UI nodes can now respond to the pointer, the foundation for buttons and menus.

- `Interactable` — an authored marker opting a node into picking (auto-attaches
  `UiNode` + `ComputedLayout` + `UiInteraction`), reflection-registered.
- `UiInteraction` — the node's derived `'none' | 'hovered' | 'pressed'` state
  (not serialized), updated each frame.
- `UiClicked` — a message emitted when a primary-button press begins on a node
  and releases over the same node.
- `pickTopmost` — hit-tests a point against interactive nodes, returning the
  front-most by depth-first paint order. `updateUiInteraction` resolves one
  frame of hover/press state + click emission (pure but for two callbacks).
- `UiInteractionPlugin` — runs the picking system in `preUpdate` after the input
  update; reads `CursorPosition` + `MouseButtonInput` from `@retro-engine/input`
  (a new `ui` dependency). Headless/no-input → no-op. `UiPointer` tracks the hot
  and pressed nodes across frames.

Verified end-to-end: the `sample-game` export shows a centered "CLICK ME" button
that tints on hover/press and increments a "CLICKS: N" label — driven through the
real input backend in a browser (Playwright). Unit tests cover pick + the full
hover/press/click state machine (69 UI tests); a `ui-picking` bench joins the
suite. Widgets (button/slider components, focus, spatial nav) build on this.
