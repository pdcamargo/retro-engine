---
'@retro-engine/engine': minor
---

feat(engine): window fullscreen toggle

Extends the `WindowBackend` write-back seam (ADR-0170) with fullscreen. A new
`WindowMode` resource (`fullscreen: boolean`, runtime — not serialized) is the
game-facing API; `WindowPlugin` applies changes to the window each frame via the
backend:

```ts
app.addSystem('update', [Res(KeyboardInput), ResMut(WindowMode)], (keys, mode) => {
  if (keys.justPressed('F11')) mode.fullscreen = !mode.fullscreen;
});
```

`WindowBackend.setFullscreen` drives the Fullscreen API in `DomWindowBackend`
(`requestFullscreen` / `exitFullscreen`) and no-ops in `HeadlessWindowBackend`.
Pure `reconcileWindowMode` applies only on change, unit-tested with a mock
backend. Fullscreen entry is browser-gesture-gated (set it from a click / key
press), same as pointer lock.
