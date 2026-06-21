---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): `ui.setKeyboardFocusHere(offset?)` for programmatic focus

Adds a thin wrapper over Dear ImGui's `SetKeyboardFocusHere` to the normalized `ui` surface, so callers can focus a following widget (e.g. auto-focus a search field when a popup opens). `offset` selects which item ahead to focus (`0` = the next widget, the default).
