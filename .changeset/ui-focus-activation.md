---
'@retro-engine/ui': minor
---

feat(ui): focus activation (Enter / gamepad → click the focused widget)

Completes UI focus (Phase 2). A `UiActivate` message tells the focus system to
activate `UiFocus.current`, which it does by emitting a `UiClicked` on that
entity — so keyboard/gamepad activation drives the exact same click path as the
pointer, and buttons, toggles, and anything reading `UiClicked` respond
identically:

```ts
app.addSystem('update', [MessageWriter(UiActivate)], (w) => {
  if (keys.justPressed('Enter') || pad?.buttons.justPressed('South')) w.write(new UiActivate());
});
```

The system runs after focus moves and before the toggle consumer, so the
synthetic click is seen the same frame. The decision is a pure
`shouldActivateFocused` (unit-tested). Focus is now navigate + ring + activate.
