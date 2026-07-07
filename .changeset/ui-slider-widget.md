---
'@retro-engine/ui': minor
---

feat(ui): UiSlider (draggable value) widget

Second widget of in-game UI depth Phase 1. `UiSlider` holds a scalar in
`[min, max]` that tracks the pointer's horizontal position across the node's
track while the slider is held, emitting `UiSliderChanged` on change:

```ts
cmd.spawn(new UiSlider({ min: 0, max: 1, value: 0.5 }));
app.addSystem('update', [MessageReader(UiSliderChanged)], (events) => {
  for (const s of events) audio.setBusVolume('music', s.value);
});
```

The drag is driven off `UiPointer.pressed` (the press-origin node), so it works
whether you grab the track or the thumb. The mapping is a pure
`computeSliderValue(cursorX, trackX, trackWidth, min, max)` — unit-tested for
edge clamping, midpoint, non-zero min, and an unlaid-out (zero-width) track. The
widget owns the value; visual fill is composed by the game.
