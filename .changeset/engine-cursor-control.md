---
'@retro-engine/engine': minor
---

feat(engine): window cursor control (visibility + pointer lock)

`WindowPlugin` gains the **write** side of windowing via a new `WindowBackend`
HAL (headless-safe, mirroring `InputBackend`/`AudioBackend`; ADR-0170). A
`CursorOptions` resource (`visible`, `grab: 'none' | 'locked'`) is the game-facing
API — set `grab: 'locked'` (from a click) for FPS/free-look mouselook, then read
`MouseMotion` deltas:

```ts
app.addPlugin(new WindowPlugin({ cursorTarget: canvas }));
app.addSystem('update', [Res(MouseButtonInput), ResMut(CursorOptions)], (m, c) => {
  if (m.justPressed('Left')) c.grab = 'locked';
});
```

`DomWindowBackend` toggles the element's CSS cursor + drives the Pointer Lock
API; a `HeadlessWindowBackend` no-ops (and is the default until a `cursorTarget`
is supplied). Pure `reconcileCursor` applies to the backend only on change,
unit-tested with a mock backend. `CursorOptions` is runtime state (not
serialized). Pointer lock is browser-gesture-gated by design.
