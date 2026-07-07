---
'@retro-engine/ui': minor
---

feat(ui): text-input widget (UiTextInput)

An editable single-line text field, the biggest of the in-game-ui-depth widgets.
`UiTextInput` (reflection-registered; auto-attaches `Interactable` + `Focusable`)
holds the `value` + caret; `UiTextInputPlugin` focuses it on click and, while
focused, folds the frame's typed characters (`@retro-engine/input`'s
`ReceivedCharacters`) and caret keys (Backspace / Delete / arrows / Home / End)
into the value, mirroring it into the node's `UiText` for rendering (a
`placeholder` shows while empty). Emits `UiTextChanged` on value changes.

```ts
app.addPlugin(new UiTextInputPlugin());
cmd.spawn(new UiTextInput({ placeholder: 'name…', maxLength: 16 }), new UiText({ font }));
```

The editing logic is pure and unit-tested — `insertText`, `applyEditKey`, and
`applyTextInputFrame` (caret keys apply before this frame's typed text). Caret
rendering and key-repeat are follow-ups; multi-keystroke IME is out of scope
(tracked on the input side).
