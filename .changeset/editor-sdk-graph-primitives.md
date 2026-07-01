---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): draw-list text/bezier primitives + input passthroughs

Additive surface for the graph-editor toolkit (ADR-0138), useful to any panel:

- `Draw.textAt(pos, col, text, { font?, size? })` — pure draw-list text via
  `AddTextImFontPtr` with an explicit pixel size and **no** ImGui item submission
  (unlike `Draw.text`), for high-volume transform-positioned labels.
- `Draw.bezierCubic(p1, p2, p3, p4, col, thickness, segments?)`.
- `ui` input passthroughs: `isWindowHovered`, `isWindowFocused`, `mouseWheel`,
  `isMouseDown` / `isMouseClicked` / `isMouseReleased` / `isMouseDoubleClicked`,
  `isMouseDragging`, `mouseDragDelta`, `resetMouseDragDelta` — so consumers gate
  navigation/drag without reaching past the SDK to raw jsimgui.
