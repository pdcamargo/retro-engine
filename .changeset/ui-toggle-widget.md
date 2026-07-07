---
'@retro-engine/ui': minor
---

feat(ui): UiToggle (checkbox) widget

First widget of in-game UI depth Phase 1. `UiToggle` is a two-state
toggle/checkbox that flips its `checked` state each time the node is clicked,
emits a `UiToggled` message, and drives its `backgroundColor` from the state — all
on top of the existing `Interactable` / `UiClicked` interaction foundation.

```ts
cmd.spawn(new UiToggle({ checked: true }));
app.addSystem('update', [MessageReader(UiToggled)], (events) => {
  for (const t of events) applyMuteSetting(t.checked);
});
```

The flip logic is exposed as a pure `applyToggleClicks` (unit-tested: flips on
click, ignores non-toggles and `Disabled` nodes, batches multiple clicks); the
plugin wires it after the picking system so this frame's clicks are seen.
