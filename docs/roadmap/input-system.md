# Input System

- **Created:** 2026-05-21
- **Status:** Planning

## Goal

`packages/input` provides a platform-agnostic input system: keyboard, mouse, gamepad, and touch. Same API in the browser and inside Tauri. Engine systems poll input via ECS resources or react via input events; no direct DOM listeners in game code.

## Phases

1. **Backend abstraction** — `InputBackend` interface implemented per platform (browser DOM, Tauri global shortcuts where useful).
2. **Action bindings** — abstract "actions" (e.g. `Jump`, `MoveX`) mapped to concrete inputs (keys, gamepad buttons, mouse). Configurable at runtime.
3. **State + events** — pressed/released/held states; per-frame snapshot consumable by systems.
4. **Gamepad support** — Web Gamepad API; reconnect handling.
5. **Touch & gestures** — pan, pinch, swipe. Deferred until mobile is a target.
6. **Studio integration** — input binding editor.

## Open questions

- ECS surface: resource (`Res<Input>`) or events? Both? Mirrors Bevy.
- Multi-player local input: how do we identify which gamepad belongs to which player entity?
- Tauri-specific: do we want raw OS-level input (e.g. global shortcuts) at all, or stick to webview-scoped?
- Text input vs game input: separate channels? Studio definitely needs text input distinct from game-input handling.

## Links

- Bevy `InputPlugin`
- Web Gamepad API
- Tauri global shortcut plugin
