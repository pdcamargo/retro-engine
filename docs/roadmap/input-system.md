# Input System

- **Created:** 2026-05-21
- **Status:** In progress (Phase 1 shipped 2026-07-06)
- **ADR:** [ADR-0144](../adr/ADR-0144-input-system-architecture.md)

## Goal

`packages/input` (`@retro-engine/input`) provides a platform-agnostic input
system: keyboard, mouse, gamepad, and touch. Same API in the browser and inside
Tauri. Engine systems poll input via ECS resources; no direct DOM listeners in
game code. Mirrors Bevy's `ButtonInput<T>` / `Axis<T>` model with an
action-mapping layer on top.

## Phases

### Phase 1 — Core: keyboard + mouse + backend HAL ✅ (2026-07-06)

- `ButtonInput<T>` (pressed / just-pressed / just-released) + `Axis<T>` primitives.
- ECS resources: `KeyboardInput`, `MouseButtonInput`, `MouseMotion`, `MouseScroll`,
  `CursorPosition`.
- `InputBackend` interface + `DomInputBackend` (window/pointer-target listeners) +
  `HeadlessInputBackend` (no-op).
- `InputPlugin` with the `preUpdate` clear-then-drain lifecycle; headless-safe;
  focus-loss releases held buttons.
- Tests, a per-frame bench, a playground `?mode=input` sample.

### Phase 2 — Action map + reflection

- Named actions (`Jump`, `MoveX`) mapped to keys / mouse buttons / axes, resolvable
  at runtime. Composite axes (e.g. A/D → −1/+1) and 2D vectors (WASD → dir).
- `ActionMap` authored resource **with a reflection schema** (serialized), registered
  by `InputPlugin`. `Actions` runtime resource surfacing per-action button/axis state.
- Sample rebinds an action and drives an entity through the action layer.

### Phase 3 — Gamepad

- Web Gamepad API polling (poll each frame in `preUpdate`; the API has no events for
  button state). `GamepadButtonInput` + `GamepadAxis` per connected pad; connect /
  disconnect handling; dead-zone + per-axis calibration. Multi-pad → player mapping.

### Phase 4 — Touch & gestures

- `Touches` resource (active touch points); tap / pan / pinch / swipe recognizers.
- Deferred until mobile export is on the table (needs WebGL2 first).

### Phase 5 — Studio integration

- Input binding editor panel (edit the `ActionMap`, live-rebind), MCP command to
  set/inspect bindings.

## Open questions (resolved / remaining)

- **ECS surface: resource or events?** → Resources first (Phase 1), Bevy-style.
  A raw-event reader can layer on later if a use case needs every event.
- **Multi-player local input** (which gamepad → which player) → Phase 3.
- **Tauri OS-global input** → out of scope; game input is webview-scoped (ADR-0144).
- **Text input vs game input** → the studio uses ImGui's own text capture; game text
  input is a Phase 2+ concern (a separate channel), not mixed into `KeyboardInput`.

## Links

- [ADR-0144](../adr/ADR-0144-input-system-architecture.md) — architecture
- Bevy `InputPlugin`, `leafwing-input-manager`
- Web Gamepad API; UI Events `KeyboardEvent.code`
