---
'@retro-engine/ui': minor
---

feat(ui): focus + spatial navigation

In-game UI depth Phase 2 (ADR-0163). Keyboard/gamepad focus for the UI: a
`UiFocus` resource holds the single focused entity, a `Focusable` marker opts a
node in, and a `UiNavigate` message moves focus — game code maps its input (Tab,
arrows, d-pad, stick) to a direction, keeping the focus layer device-agnostic.

```ts
app.addPlugin(new UiFocusPlugin());
cmd.spawn(new UiNode(...), new Focusable());
app.addSystem('update', [MessageWriter(UiNavigate)], (w) => {
  if (keys.justPressed('Tab')) w.write(new UiNavigate('next'));
  if (keys.justPressed('ArrowRight')) w.write(new UiNavigate('right'));
});
```

`'next'`/`'prev'` walk tab order (layout paint order); `'up'`/`'down'`/`'left'`/
`'right'` pick the nearest neighbour by a distance-along-axis + perpendicular
penalty (aligned beats skewed). The nav math is pure `tabNavigate` /
`spatialNavigate` (unit-tested); focus pointing at a despawned node self-clears.
Activating the focused widget + a focus ring are tracked follow-ups.
