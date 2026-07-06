---
'@retro-engine/input': minor
---

feat(input): Phase 3 — gamepad (`Gamepads` resource)

Per ADR-0146, poll-based gamepad support (the Web Gamepad API has no button events), added as a source parallel to the event backend.

**New public surface:**

- `GamepadSource` — `poll(): GamepadSnapshot[]`. `NavigatorGamepadSource` reads `navigator.getGamepads()` fresh each frame (no cached references; no-op without a gamepad-capable `navigator`); `HeadlessGamepadSource` for tests. Inject a scripted source via `InputPlugin({ gamepadSource })`.
- `Gamepads` — resource keyed by pad index. Per-pad `GamepadState` reuses `ButtonInput<GamepadButton>` (digital, per-frame edges) + `Axis<GamepadAxis>` (analog, dead-zoned). `get(index)` / `first()` / `all()` / `connectedIndices()`; configurable `deadZone` (default 0.1); connect/disconnect via poll reconciliation. Raw index access (`buttonAt` / `axisAt`) for non-standard pads.
- W3C **Standard Gamepad** normalization: `GamepadButton` (`South`/`East`/`West`/`North`, shoulders, triggers, `Select`/`Start`, stick clicks, d-pad, `Home`) and `GamepadAxis` (`LeftStickX/Y`, `RightStickX/Y`, `LeftTrigger`, `RightTrigger`). Stick-Y flipped so **up is +1**. Named access only when `mapping === 'standard'`.
- `updateGamepads`, `applyDeadZone`, `STANDARD_BUTTONS` / `STANDARD_STICK_AXES` tables.

`InputPlugin` polls the source and reconciles `Gamepads` in `preUpdate` (after the raw device update). Gamepad state is transient (not serialized). Binding gamepad through the action map (`ActionBinding` `'gamepad'` device) is a tracked follow-up.
