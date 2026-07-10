---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): let the inspector set optional/nullable fields

An optional or nullable field that is currently `undefined`/`null` previously
rendered a dead "(unset)" row with no way to give it a value. It now shows a
**Set** button that assigns a sensible default (`defaultValueFor`) through the
history-backed edit boundary (so it's undoable), after which the field edits
normally. This makes authored-but-omitted fields fillable from the inspector —
e.g. a `UiNode`'s `backgroundColor` / `width` / `borderColor`, and any other
optional field. Required fields and read-only fields are unaffected; kinds with
no synthesizable default (nested type / variant) still show the plain label.
