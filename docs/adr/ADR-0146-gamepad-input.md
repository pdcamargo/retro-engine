# ADR-0146: Gamepad input (poll-based source)

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

ADR-0144 built the input package around an event-drain HAL (`InputBackend.drain()`),
which fits keyboard and mouse — the DOM delivers those as events. The **Web Gamepad
API has no button events**: button and axis state is only readable by *polling*
`navigator.getGamepads()` each frame, and the returned objects must be re-fetched
every frame rather than cached from an earlier reference. Only `gamepadconnected` /
`gamepaddisconnected` are events. So gamepad does not fit the event-drain model.

Browsers normalize most controllers to the **W3C "Standard Gamepad"** layout
(`gamepad.mapping === 'standard'`): buttons `0..16` (face S/E/W/N, shoulders,
triggers, select/start, stick clicks, d-pad, home) and axes `0..3` (left X/Y,
right X/Y), with **stick Y negative-up**. Non-standard controllers report
`mapping === ''` with device-specific indices.

## Decision

Gamepad ships as a **separate poll-based source**, parallel to the event backend,
not folded into `InputBackend`:

- **`GamepadSource`** interface — `poll(): readonly GamepadSnapshot[]`. A
  `GamepadSnapshot` is a plain per-pad record (`index`, `id`, `mapping`,
  `connected`, `buttons: {pressed, value}[]`, `axes: number[]`).
  `NavigatorGamepadSource` reads `navigator.getGamepads()` fresh each poll (never
  caches pad references); `HeadlessGamepadSource` returns `[]`. `InputPlugin`
  installs the navigator source when a gamepad-capable `navigator` is present,
  else headless.
- **Standard-mapping normalization** — named `GamepadButton`
  (`South`/`East`/`West`/`North`, `LeftShoulder`/`RightShoulder`,
  `LeftTrigger`/`RightTrigger`, `Select`/`Start`, `LeftStick`/`RightStick`,
  `DPadUp`/`DPadDown`/`DPadLeft`/`DPadRight`, `Home`) and `GamepadAxis`
  (`LeftStickX/Y`, `RightStickX/Y`, `LeftTrigger`, `RightTrigger`). Named access is
  populated only when `mapping === 'standard'`; raw index access
  (`buttonAt(i)` / `axisAt(i)`) is always available so non-standard pads still work.
  **Stick Y is negated** on ingest so up/forward is `+1` — matching the action
  map's "+y is up" (ADR-0145) and Bevy.
- **Per-pad state** — a `GamepadState` reuses the ADR-0144 primitives: a
  `ButtonInput<GamepadButton>` (digital, edges re-derived each poll from the
  level-triggered API), an `Axis<GamepadAxis>` (analog, dead-zoned), and analog
  button values for the triggers.
- **`Gamepads` resource** — keyed by pad index; exposes `get(index)`, `first()`
  (single-player convenience), `all()`, and `connectedIndices()`. A configurable
  **dead zone** (`deadZone`, default `0.1`) is applied per stick axis with
  rescaling so values ramp from 0 at the edge of the zone. Connect / disconnect
  is handled by **poll reconciliation** — a pad absent from a poll is marked
  disconnected — rather than the DOM connect events (the poll is the single source
  of truth).
- **Update** runs in `preUpdate` after the ADR-0144 `input-update` system:
  poll the source, reconcile the resource, and for each pad `clear()` the button
  transients then `press`/`release` from the current snapshot so
  `justPressed`/`justReleased` are correct off a level-triggered API.

All gamepad state is transient (not serialized). Binding gamepad inputs through
the ADR-0145 action map (a new `'gamepad'` binding device + analog-axis sources)
is a tracked follow-up, not part of this phase.

## Consequences

- Gamepad support sits behind a clean seam: a test can drive a deterministic
  `GamepadSource` with scripted snapshots (no hardware, no DOM), and a future
  Tauri/native source conforms to the same `poll()` contract.
- The named-mapping-only-when-`standard` rule keeps the common case ergonomic while
  never dropping data for exotic pads (raw index access remains).
- Poll reconciliation means no separate connect/disconnect wiring and no stale
  pad references — at the cost of connect/disconnect being observed at frame
  granularity (fine for gameplay).
- Reusing `ButtonInput` / `Axis` means no new state machinery, and the action-map
  layer can later treat a gamepad button/axis as just another binding source.
- Local multiplayer maps naturally onto per-index `GamepadState`; assigning a pad
  to a player entity is left to game code for now.

## Implementation

- `packages/input/src/gamepad-mapping.ts` — `GamepadButton`, `GamepadAxis`,
  standard-mapping index tables.
- `packages/input/src/gamepad-source.ts` — `GamepadSnapshot`, `GamepadSource`,
  `NavigatorGamepadSource`, `HeadlessGamepadSource`.
- `packages/input/src/gamepad.ts` — `GamepadState`, `Gamepads`, `applyDeadZone`,
  `updateGamepads`.
- `packages/input/src/input-plugin.ts` — `InputPlugin` installs the source and the
  `gamepad-update` system.
