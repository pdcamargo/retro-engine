---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): mouse-position queries on the UI wrapper

Add `ui.mousePos()` (screen space), `ui.windowPos()` (current window top-left, screen space), and `ui.windowMousePos()` (mouse relative to the current window's top-left — `(0, 0)` at the corner). Useful for picking and canvas interactions inside a panel.
