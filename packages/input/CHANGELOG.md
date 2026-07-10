# @retro-engine/input

## 0.1.0

### Minor Changes

- 51e8516: feat(input): analog gamepad axes as action sources

  Completes the gamepad action-map binding path (P1 input follow-up): a real analog
  stick now drives an `axis` / `axis2d` action with its continuous `[-1, 1]` value,
  not just the digital `positiveX`/`negativeX` legs.

  - `gamepadAxis(axis)` — a new source for a stick axis or trigger (via the first
    connected pad's dead-zoned axes).
  - `.stick(name, source)` / `.stick2d(name, { x, y })` — pure-analog axis / axis2d
    shorthands. `.axis` / `.axis2d` also gain an optional `analog` field, so a single
    action can carry both WASD legs and a stick — the larger-magnitude input wins.
  - New `analogX` / `analogY` binding roles; `resolveActionState` reads a
    `gamepadAxes` query and folds the analog value into each axis component.

  Also fixes a latent reflection gap: the `ActionBinding.device` schema now
  enumerates `'gamepad'` (gamepad-button bindings from the prior slice already
  produced that device but the schema rejected it on save).

  Note: `ActionInputs` gains a required `gamepadAxes` field — a signature change for
  anything constructing it directly.

- dcc84d2: feat(input): gamepad buttons in the ActionMap

  Gamepad buttons are now bindable through the action map (P1 input follow-up),
  alongside keyboard and mouse — so an action rebinds to a gamepad button without
  reading `Gamepads` directly.

  - New `gamepadButton(button)` source + a `'gamepad'` `InputDevice`. It plugs into
    the existing `ActionMap` builders unchanged: `.button('Jump',
gamepadButton('South'))`, a virtual D-pad via `.axis2d(...)` from D-pad buttons,
    or mixed with keyboard/mouse on one action (OR-ed).
  - `resolveActionState` now takes an `ActionInputs` bundle (`{ keyboard, mouse,
gamepad }`) instead of positional keyboard/mouse args, and reads gamepad
    bindings from the first connected pad. **Breaking** for direct callers of
    `resolveActionState` (the plugin path is unaffected).

  Digital buttons only; analog stick axes as action sources are a follow-up.
  Unit-tested (gamepad button press → action; mixed gamepad+keyboard; a virtual
  D-pad `axis2d` from gamepad buttons).

- a1350d0: feat(input): Phase 2 — action map (`ActionMap` / `ActionState`)

  Per ADR-0145, a component-based action layer over the raw device input, mirroring Bevy's `leafwing-input-manager`. Bind named actions to physical inputs, read resolved per-action state by name, rebind at runtime, and round-trip the bindings through a saved scene.

  **New public surface:**

  - `ActionMap` — authored component (reflection schema, serialized) holding `ActionDef[]`, with a fluent builder: `.button(name, ...sources)`, `.axis(name, { negative, positive })`, `.axis2d(name, { left, right, up, down })`. Declares `static requires = [ActionState]`.
  - `ActionState` — derived component (auto-attached, **not** serialized) exposing `pressed` / `justPressed` / `justReleased` / `value` / `axis` / `axis2d` per action name. Edge state is computed against the previous frame, so many-to-many bindings resolve correctly.
  - `ActionBinding`, `ActionDef` — serializable value types (registered via `registerType`); `key(code)` / `mouseButton(button)` source helpers; `InputDevice` / `BindingRole` / `ActionKind` / `ActionSource` / `Axis2dValue` types.
  - `resolveActionState` — pure per-frame resolver (button = any trigger held; `axis` = positiveX − negativeX; `axis2d` = a virtual D-pad into `{ x, y }`).

  `InputPlugin` now registers the schemas and runs an `action-update` system in `preUpdate` (after the raw device update) that resolves every `(ActionMap, ActionState)` entity. Composite axes are raw button sums (unit-normalized diagonals + true analog gamepad axes come in Phase 3).

- b3db22b: feat(input): Phase 3 — gamepad (`Gamepads` resource)

  Per ADR-0146, poll-based gamepad support (the Web Gamepad API has no button events), added as a source parallel to the event backend.

  **New public surface:**

  - `GamepadSource` — `poll(): GamepadSnapshot[]`. `NavigatorGamepadSource` reads `navigator.getGamepads()` fresh each frame (no cached references; no-op without a gamepad-capable `navigator`); `HeadlessGamepadSource` for tests. Inject a scripted source via `InputPlugin({ gamepadSource })`.
  - `Gamepads` — resource keyed by pad index. Per-pad `GamepadState` reuses `ButtonInput<GamepadButton>` (digital, per-frame edges) + `Axis<GamepadAxis>` (analog, dead-zoned). `get(index)` / `first()` / `all()` / `connectedIndices()`; configurable `deadZone` (default 0.1); connect/disconnect via poll reconciliation. Raw index access (`buttonAt` / `axisAt`) for non-standard pads.
  - W3C **Standard Gamepad** normalization: `GamepadButton` (`South`/`East`/`West`/`North`, shoulders, triggers, `Select`/`Start`, stick clicks, d-pad, `Home`) and `GamepadAxis` (`LeftStickX/Y`, `RightStickX/Y`, `LeftTrigger`, `RightTrigger`). Stick-Y flipped so **up is +1**. Named access only when `mapping === 'standard'`.
  - `updateGamepads`, `applyDeadZone`, `STANDARD_BUTTONS` / `STANDARD_STICK_AXES` tables.

  `InputPlugin` polls the source and reconciles `Gamepads` in `preUpdate` (after the raw device update). Gamepad state is transient (not serialized). Binding gamepad through the action map (`ActionBinding` `'gamepad'` device) is a tracked follow-up.

- 23477f9: feat(input): surface OS key auto-repeat on ButtonInput

  `ButtonInput` now tracks a per-frame **repeated** set fed from the DOM's
  auto-repeat `keydown` events (which already carried a `repeat` flag): `press(input,
repeat)` routes a repeat into `repeated(input)` without re-firing `justPressed`.
  `justPressedOrRepeated(input)` is the "act now, then repeat while held" test —
  useful for held-direction menu scrolling and text editing. Using the OS repeat
  cadence means no engine-side repeat timer and it honors the user's system key-
  repeat settings.

  `@retro-engine/ui`'s `UiTextInput` now uses it, so holding Backspace / Delete /
  an arrow repeats the edit at the OS cadence (typed characters already repeated via
  `ReceivedCharacters`). Unit-tested.

- b3d33a0: feat(input): Phase 1 — keyboard + mouse input package (`@retro-engine/input`)

  Per ADR-0144, a new platform-agnostic input package layered on `@retro-engine/engine`, with the same API in the browser and inside the Tauri webview. Add `InputPlugin` to an `App` and read input through ECS resources — no DOM listeners in game code. Headless-safe: with no `window` present the plugin installs a no-op backend, so tests and server worlds run unchanged.

  **New public surface:**

  - `ButtonInput<T>` — generic per-frame button state with `pressed` / `justPressed` / `justReleased` (+ `anyPressed` / `allPressed` / getters / `press` / `release` / `releaseAll` / `clear` / `reset*`). Mirrors Bevy's `ButtonInput<T>`.
  - `Axis<T>` — generic clamped analog values (default range `[-1, 1]`).
  - `KeyboardInput extends ButtonInput<KeyCode>` — keyboard state keyed by physical `KeyCode` (`KeyboardEvent.code`, so WASD stays WASD across layouts).
  - `MouseButtonInput extends ButtonInput<MouseButton>`, plus per-frame `MouseMotion` (delta), `MouseScroll` (wheel delta + unit), and `CursorPosition` (target-local pixels + `present`).
  - `InputBackend` interface (`attach` / `detach` / `drain`) with `DomInputBackend` (window + pointer-target listeners, idempotent attach) and `HeadlessInputBackend` (no-op).
  - `InputPlugin` — inserts the resources and runs the once-per-frame `preUpdate` clear-then-drain that keeps `justPressed` / `justReleased` scoped to the current frame; focus loss releases held buttons. Not in `CorePlugin` — hosts opt in.
  - `applyInputFrame`, `mouseButtonFromIndex` helpers.

  All input state is transient (recomputed each frame) and deliberately unregistered for serialization; the authored action map arrives in Phase 2 with a reflection schema.

- 087b196: feat(input): text-input character stream (ReceivedCharacters)

  A layout- and Shift-aware stream of typed characters, distinct from the physical
  `KeyboardInput` (which stays keyed on `KeyCode` positions for gameplay bindings).
  Read `Res(ReceivedCharacters)` for the characters typed this frame — `chars()`,
  `text()`, `length` — to drive text fields, chat, a debug console, or the coming
  UI text-input widget:

  ```ts
  app.addSystem(
    "update",
    [Res(ReceivedCharacters), ResMut(field)],
    (typed, f) => {
      f.value += typed.text();
    }
  );
  ```

  `InputPlugin` clears it and fills it from the backend each frame. The pure
  `charFromKeyDown` filter (exported) keeps only single printable characters and
  drops command chords (Ctrl/Meta), allowing AltGr; the `DomInputBackend` emits a
  new `char` raw event off `KeyboardEvent.key` (so the OS layout + Shift are already
  applied). ADR-0169. Unit-tested. IME composition is a follow-up.

- 9bf0721: feat(input): Phase 4 — touch (`Touches` resource)

  Touch input via the existing event-drain backend (ADR-0144), completing the P0 input surface (keyboard + mouse + action map + gamepad + touch).

  **New public surface:**

  - `Touches` — resource of active `TouchPoint`s, read via `Res(Touches)`. `iter()` / `first()` / `count()` / `get(id)`, plus `justStarted(id)` / `justEnded(id)` / `anyJustStarted()`. Mirrors the `ButtonInput` per-frame lifecycle: transition sets and per-frame deltas are valid only for the current frame.
  - `TouchPoint` — `id`, current `x`/`y` and `startX`/`startY` (target-local pixels), per-frame `deltaX`/`deltaY`, and `phase` (`started` / `moved` / `stationary` / `ended` / `canceled`).
  - `TouchPhase` type.

  `DomInputBackend` now emits `touch-start` / `touch-move` / `touch-end` / `touch-cancel` events (per changed touch, coordinates mapped to the pointer target, `preventDefault` on start/move gated by `preventDefaults`), and `applyInputFrame` folds them into `Touches` in the same `preUpdate` step as keyboard/mouse. Transient — not serialized. Gesture recognizers (tap/pan/pinch/swipe) are a P1 follow-up; touch works in any browser today (mobile _export_ still needs the WebGL2 backend).

- 056bfc9: feat: expose feature-component reflection registration independent of the plugins

  Each feature plugin now factors its component-schema registration into a standalone, exported function so a host (e.g. an editor's component palette) can register the component _types_ for authoring and serialization without installing the plugin's systems or render passes.

  New public surface:

  - `@retro-engine/physics-core`: `registerPhysicsComponents(app)` — all 2D/3D bodies, colliders, velocities, forces, materials, character controllers, and joints.
  - `@retro-engine/audio`: `registerAudioComponents(app)` — `AudioSource`, `AudioListener`.
  - `@retro-engine/input`: `registerInputComponents(app)` — `ActionBinding`/`ActionDef` value types + the `ActionMap` component.
  - `@retro-engine/ui`: `registerUiComponents(app)` — every UI component (layout, text, image, style class, button/toggle/slider/text-input, and the interaction/focus/diagnostics markers), plus the now-exported `uiButtonSchema` / `uiToggleSchema` / `uiSliderSchema` / `uiTextInputSchema`.
  - `@retro-engine/engine`: `registerSpriteComponents(app)`, `registerLight2dComponents(app)`, `registerTextComponents(app)` — the sprite (+ atlas), 2D light, and text component schemas.

  Each owning plugin's `build` now delegates to its function, so behavior is unchanged. Registering the same constructor twice is idempotent, so calling these alongside the full plugin is safe.

- 8259a32: feat(input): touch gesture recognizers — tap + swipe

  Adds tap/swipe gesture recognition on top of `Touches` (P1 input follow-up).

  - `recognizeGestures(touches, nowMs, state, config)` — a pure recognizer that
    records each touch's start time and, on release, classifies it by travel +
    duration into a `TapGesture` (quick, still) or a directional `SwipeGesture`
    (far, fast; up/down/left/right from the dominant axis). Canceled touches emit
    nothing. Tunable via `TouchGestureConfig` (`DEFAULT_TOUCH_GESTURE_CONFIG`).
  - `TouchGesturePlugin` (opt-in) runs it in `preUpdate` right after the input
    drain and emits `TapGesture` / `SwipeGesture` messages — read with
    `MessageReader`. Requires `InputPlugin` (for `Touches`).

  Unit-tested: tap, swipe direction (incl. dominant-axis selection), the
  neither-case (too slow / too short), a far-but-slow drag rejected as a swipe,
  and canceled touches dropped without a late gesture.

- c6163cb: feat(input): pan + pinch touch gestures

  Completes the touch gesture recognizers (P1 input follow-up) alongside tap +
  swipe.

  - `PanGesture` — a single moving touch, emitted per frame (continuous drag) with
    the touch position + per-frame delta.
  - `PinchGesture` — two active touches, the incremental `scale` of their
    separation each frame (`>1` spreading apart, `<1` pinching in) plus the pinch
    center.

  `recognizeGestures` now also returns `pans` + `pinches` (tracking the two-touch
  distance across frames in `TouchGestureState`), and `TouchGesturePlugin` emits
  them as messages. Unit-tested (pan delta only after the down frame; pinch scale
  spreading/together; a single touch is a pan, never a pinch).

### Patch Changes

- Updated dependencies [45c51aa]
- Updated dependencies [1b9b7f5]
- Updated dependencies [7d40c1a]
- Updated dependencies [937f2cb]
- Updated dependencies [b315044]
- Updated dependencies [d5424c3]
- Updated dependencies [e0c4984]
- Updated dependencies [15617ff]
- Updated dependencies [ab6e7b9]
- Updated dependencies [1b66f35]
- Updated dependencies [0baa8a9]
- Updated dependencies [7142f6f]
- Updated dependencies [2c27d90]
- Updated dependencies [7e26e59]
- Updated dependencies [e73d32e]
- Updated dependencies [9c36012]
- Updated dependencies [12eb41d]
- Updated dependencies [773fabd]
- Updated dependencies [afc904c]
- Updated dependencies [3b3cf7f]
- Updated dependencies [2c27d90]
- Updated dependencies [a9837c6]
- Updated dependencies [f8079c6]
- Updated dependencies [e8c703e]
- Updated dependencies [2324f9f]
- Updated dependencies [294c161]
- Updated dependencies [597b913]
- Updated dependencies [6e1d04c]
- Updated dependencies [2f22822]
- Updated dependencies [62e382e]
- Updated dependencies [5d7a21a]
- Updated dependencies [8d36fd7]
- Updated dependencies [3b04954]
- Updated dependencies [1280e03]
- Updated dependencies [fdde82f]
- Updated dependencies [9d41f83]
- Updated dependencies [056bfc9]
- Updated dependencies [1cdff13]
- Updated dependencies [1c76eef]
- Updated dependencies [d8b7fc2]
- Updated dependencies [5ea3e80]
- Updated dependencies [68963c6]
- Updated dependencies [be766a4]
- Updated dependencies [bc7640e]
- Updated dependencies [cad5613]
- Updated dependencies [4741039]
- Updated dependencies [4ca7beb]
- Updated dependencies [0bc6ca5]
- Updated dependencies [e163274]
- Updated dependencies [5317052]
- Updated dependencies [5599db7]
- Updated dependencies [5988cb6]
- Updated dependencies [a055d25]
- Updated dependencies [2a7a18b]
- Updated dependencies [da51d57]
- Updated dependencies [c2732c5]
- Updated dependencies [fad8a5e]
- Updated dependencies [1c4a0fe]
- Updated dependencies [c4bf47a]
- Updated dependencies [7812b83]
- Updated dependencies [8e4574a]
- Updated dependencies [be4aad1]
- Updated dependencies [88d0fc5]
- Updated dependencies [01070b1]
- Updated dependencies [b788a60]
- Updated dependencies [a3b6d83]
- Updated dependencies [43cae6c]
- Updated dependencies [90a56e2]
- Updated dependencies [88d3ca3]
- Updated dependencies [68ce298]
- Updated dependencies [b5e3322]
- Updated dependencies [10bda28]
- Updated dependencies [ca1cafa]
- Updated dependencies [e97fdd2]
- Updated dependencies [3db9d87]
- Updated dependencies [0c7b778]
- Updated dependencies [781aa88]
- Updated dependencies [7142f6f]
- Updated dependencies [eb3c452]
- Updated dependencies [e6728cc]
- Updated dependencies [8029403]
- Updated dependencies [d63d0f9]
- Updated dependencies [c049410]
- Updated dependencies [707714f]
- Updated dependencies [3658119]
- Updated dependencies [ac35dac]
- Updated dependencies [3280a8e]
- Updated dependencies [62effe1]
- Updated dependencies [ca677c6]
- Updated dependencies [abbd55c]
- Updated dependencies [67e8513]
- Updated dependencies [8ac39a9]
- Updated dependencies [92d6c91]
- Updated dependencies [75a1a8a]
- Updated dependencies [e6728cc]
- Updated dependencies [a896a3b]
- Updated dependencies [5be634a]
- Updated dependencies [690c811]
- Updated dependencies [da1f0eb]
- Updated dependencies [056bfc9]
- Updated dependencies [7dc7bca]
- Updated dependencies [5c33631]
- Updated dependencies [fa2678b]
- Updated dependencies [67e8513]
- Updated dependencies [836a7ab]
- Updated dependencies [ea56975]
- Updated dependencies [6fbb29d]
- Updated dependencies [d25c7aa]
- Updated dependencies [4015d71]
- Updated dependencies [82ecdec]
- Updated dependencies [bcef667]
- Updated dependencies [c26f7a3]
- Updated dependencies [7b8eeea]
- Updated dependencies [8a6fb8f]
- Updated dependencies [9712180]
- Updated dependencies [bc24cd2]
- Updated dependencies [f45c5f0]
- Updated dependencies [824b04f]
- Updated dependencies [47372a5]
- Updated dependencies [73fdef4]
- Updated dependencies [88c4629]
- Updated dependencies [93f4053]
- Updated dependencies [ba77627]
- Updated dependencies [f2f082b]
- Updated dependencies [641b263]
- Updated dependencies [7812b83]
- Updated dependencies [48686b4]
- Updated dependencies [f0584f2]
- Updated dependencies [bc634ae]
- Updated dependencies [f95bac1]
- Updated dependencies [7dddd6f]
- Updated dependencies [a0fb8d4]
- Updated dependencies [59d37c2]
- Updated dependencies [acae153]
- Updated dependencies [8934a75]
- Updated dependencies [f55bffb]
- Updated dependencies [b1a1e01]
- Updated dependencies [5b52805]
- Updated dependencies [dd3de07]
- Updated dependencies [d8c0bda]
- Updated dependencies [b10dc50]
- Updated dependencies [05d2bb6]
- Updated dependencies [0f8701d]
- Updated dependencies [7f40ed1]
- Updated dependencies [591fdef]
- Updated dependencies [42d7275]
- Updated dependencies [b2a610d]
- Updated dependencies [2beee52]
- Updated dependencies [5cf81f9]
- Updated dependencies [ce20898]
- Updated dependencies [823e5cd]
  - @retro-engine/engine@0.1.0
  - @retro-engine/reflect@0.1.0
