# Input System

- **Created:** 2026-05-21
- **Status:** In progress (Phases 1–4 shipped 2026-07-06; P0 AC met — only the
  optional studio binding editor / gesture recognizers remain)
- **ADR:** [ADR-0144](../adr/ADR-0144-input-system-architecture.md) (architecture),
  [ADR-0145](../adr/ADR-0145-input-action-map.md) (action map),
  [ADR-0146](../adr/ADR-0146-gamepad-input.md) (gamepad)

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

### Phase 3 — Gamepad ✅ (2026-07-06)

- Poll-based `GamepadSource` (ADR-0146): `NavigatorGamepadSource` reads
  `navigator.getGamepads()` each frame; `HeadlessGamepadSource` for tests.
- W3C Standard-Gamepad normalization: named `GamepadButton` / `GamepadAxis`
  (raw index access for non-standard pads); stick-Y flipped so up is +1; triggers
  as `[0,1]` axes.
- `Gamepads` resource keyed by pad index — per-pad `ButtonInput<GamepadButton>` +
  `Axis<GamepadAxis>`, configurable dead zone, `first()` / `connectedIndices()`,
  connect/disconnect via poll reconciliation. Polled + reconciled in `preUpdate`.
- Playground `?mode=input` left stick moves the player, `South` fires.
- **Follow-up:** gamepad bindings in the action map (a `'gamepad'` binding device +
  analog-axis sources) — tracked in MASTER-ROADMAP.
- Multi-pad → player-entity assignment is left to game code (per-index `GamepadState`).

### Phase 4 — Touch ✅ (2026-07-06)

- `Touches` resource: active `TouchPoint`s (id, position, per-frame delta, phase)
  with a `ButtonInput`-style lifecycle (`justStarted` / `justEnded`, `iter` /
  `first` / `count`). Fed through the DOM backend's touch events (touchstart/move/
  end/cancel), applied in the same `preUpdate` frame step as keyboard/mouse.
- Playground `?mode=input` surfaces touch count + primary position.
- **Follow-up (P1):** gesture recognizers (tap / pan / pinch / swipe) on top of
  `Touches` — tracked in MASTER-ROADMAP. Works in any browser today (touch events
  don't need WebGL2); mobile *export* still depends on the WebGL2 backend.

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
