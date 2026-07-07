---
'@retro-engine/input': minor
---

feat(input): text-input character stream (ReceivedCharacters)

A layout- and Shift-aware stream of typed characters, distinct from the physical
`KeyboardInput` (which stays keyed on `KeyCode` positions for gameplay bindings).
Read `Res(ReceivedCharacters)` for the characters typed this frame — `chars()`,
`text()`, `length` — to drive text fields, chat, a debug console, or the coming
UI text-input widget:

```ts
app.addSystem('update', [Res(ReceivedCharacters), ResMut(field)], (typed, f) => {
  f.value += typed.text();
});
```

`InputPlugin` clears it and fills it from the backend each frame. The pure
`charFromKeyDown` filter (exported) keeps only single printable characters and
drops command chords (Ctrl/Meta), allowing AltGr; the `DomInputBackend` emits a
new `char` raw event off `KeyboardEvent.key` (so the OS layout + Shift are already
applied). ADR-0169. Unit-tested. IME composition is a follow-up.
