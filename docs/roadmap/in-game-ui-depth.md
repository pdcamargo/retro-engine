# In-game UI depth

Fill out `@retro-engine/ui` beyond the shipped core (flexbox layout, `.rss`
styling, MSDF text, pointer interaction, `UiButton`, `UiImage`). Promoted from the
P1 "In-game UI depth" roadmap item. Widgets reuse the existing interaction
foundation (`Interactable` / `UiInteraction` / `UiClicked`, widget-drives-
`backgroundColor`) — no new architecture per widget.

## Phase 1 — Widgets

More interactive widgets, each an authored component that reuses the picking /
`UiClicked` machinery:

- **Toggle / checkbox** ✅ — `UiToggle` flips `checked` on click, emits
  `UiToggled`, drives its background from state. Pure `applyToggleClicks` +
  unit tests.
- **Slider** ✅ — `UiSlider` maps the pointer's x across the node's track to a
  value in `[min, max]` while held (driven off `UiPointer.pressed`), emits
  `UiSliderChanged`. Pure `computeSliderValue` + unit tests. (Visual fill is
  composed by the game / a follow-up — the widget owns the value.)
- **Text input** — focus, caret, key capture, editable string. The biggest
  widget (keyboard routing + focus management + caret rendering).
- **Scrollview** — clipped content + scroll offset from wheel / drag; depends on
  clipping (a `.rss` remaining item) landing first.
- **Dropdown / tabs** — composite widgets built from the above + panels.

## Phase 2 — Focus + spatial navigation

A focus resource (which node has focus), Tab-order traversal, and D-pad/stick
spatial navigation between focusable nodes (gamepad-friendly menus). Ties into the
input action map.

## Phase 3 — Data binding

Declarative binding from a data source to node props (text, visibility, list
contents) so UI updates without hand-written sync systems.

## Phase 4 — Virtualized list / tree views

Windowed rendering of large collections (only visible rows realized), the tree
variant with expand/collapse. Depends on scrollview (Phase 1) + clipping.

## Phase 5 — Screen management

A screen/route stack (push/pop/replace) with enter/exit transitions, so a game
manages menus/HUD/modal layers without ad-hoc show/hide.
