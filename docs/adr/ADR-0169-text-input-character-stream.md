# ADR-0169: Text-input character stream (ReceivedCharacters)

- **Status:** Accepted
- **Date:** 2026-07-07
- **Extends:** ADR-0144 (input core) — sealed

## Context

`@retro-engine/input` exposes keyboard state as `ButtonInput<KeyCode>` keyed on
**physical** `KeyboardEvent.code` values — layout-independent key *positions*
(WASD stays WASD on AZERTY), exactly what gameplay bindings want. But a text
field (name entry, chat, a debug console, and the coming UI text-input widget)
needs the opposite: the **character the user typed**, honoring their OS layout,
Shift, and dead keys — `A` vs `a`, `1` vs `!`, `é`. A physical `KeyCode` cannot
produce that; `KeyboardEvent.key` can.

This is the same duality winit (`KeyCode` vs `ReceivedCharacter`) and Bevy
(`KeyboardInput` vs `EventReader<ReceivedCharacter>`) draw.

## Decision

Expose typed text as a **separate per-frame stream** alongside the physical key
state, never conflated with it.

- **A new `char` raw event.** `RawInputEvent` gains `{ kind: 'char'; char }`. The
  `DomInputBackend` emits it from `keydown` next to the existing `key-down`,
  carrying the produced character.
- **`charFromKeyDown` is the pure filter.** Given `{ key, ctrl, meta, alt }` it
  returns the character iff `key.length === 1` (a single printable character —
  named keys like `Enter`/`Shift`/arrows have longer `key` values and are
  rejected) and no command modifier is held. `Meta` (Cmd/Win) and `Ctrl` reject,
  **except** `Ctrl+Alt` (AltGr), which types characters on many layouts. Unit-
  tested independently of the DOM.
- **`ReceivedCharacters` is a per-frame resource.** It buffers the characters
  typed this frame (`chars()` / `text()` / `length`), and `InputPlugin` clears it
  at the start of each frame and fills it from the drained `char` events — the
  same clear-then-apply lifecycle as `KeyboardInput` et al., so it holds only the
  current frame's input. Read it with `Res(ReceivedCharacters)`; append its
  `text()` to a field.
- **Keyed off `KeyboardEvent.key`, not `code`.** That is what makes the character
  layout- and Shift-aware. The physical `KeyboardInput` path is unchanged and
  still the right tool for gameplay bindings.

`applyInputFrame` takes `ReceivedCharacters` as an optional trailing param, so the
bench and existing callers that don't care about text are unaffected.

## Consequences

- Games and the UI can read typed text portably without decoding key codes +
  Shift themselves. The UI text-input widget builds directly on this.
- Physical vs. character input stay cleanly separated: no accidental "W" from a
  movement key landing in a text box, no layout breakage of WASD.
- IME composition (multi-keystroke CJK input via `compositionend` / `input`
  events) is **not** covered here — a follow-up if a consumer needs it. This slice
  is the single-character `keydown` path.

## Implementation

- `packages/input/src/text-input.ts` — pure `charFromKeyDown`, `ReceivedCharacters` resource, `KeyCharInput`.
- `packages/input/src/raw-event.ts` — the `char` raw event.
- `packages/input/src/dom-backend.ts` — emit `char` from `keydown` via `charFromKeyDown`.
- `packages/input/src/input-plugin.ts` — insert `ReceivedCharacters`; clear + fill it in `applyInputFrame`.
- `packages/input/src/index.ts` — public exports.
