---
'@retro-engine/input': minor
'@retro-engine/ui': patch
---

feat(input): surface OS key auto-repeat on ButtonInput

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
