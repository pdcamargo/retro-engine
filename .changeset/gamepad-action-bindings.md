---
'@retro-engine/input': minor
---

feat(input): gamepad buttons in the ActionMap

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
