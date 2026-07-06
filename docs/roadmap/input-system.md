# Input System

- **Created:** 2026-05-21
- **Status:** In progress (Phases 1–2 shipped 2026-07-06)
- **ADR:** [ADR-0144](../adr/ADR-0144-input-system-architecture.md) (architecture),
  [ADR-0145](../adr/ADR-0145-input-action-map.md) (action map)

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

### Phase 2 — Action map + reflection ✅ (2026-07-06)

- Named actions mapped to keys / mouse buttons, resolvable at runtime. Composite
  1D axes (A/D → −1/+1) and 2D virtual D-pads (WASD → dir).
- **Component-based** (ADR-0145, leafwing-shaped): `ActionMap` authored component
  **with a reflection schema** (serialized), `ActionState` derived component
  (auto-attached Required Component, not serialized). Fluent builder + `key` /
  `mouseButton` source helpers. Registered by `InputPlugin`; resolved each frame in
  `preUpdate` after the raw device update.
- Playground `?mode=input` drives an entity through the action layer and rebinds
  `Reset` (Space↔Enter) at runtime. Reflection round-trip covered by a unit test.
- Real analog axes (gamepad) and unit-normalized diagonals fold into Phase 3.

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
