---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): viewport orientation gizmo

Add `ViewportGizmo` — a configurable camera-orientation widget for editor viewports (the three.js/Blender-style sphere gizmo). It reflects the camera's orientation as six colored X/Y/Z balls and returns intents to **drag the body to orbit** or **click a ball to align** the view to that axis; a disc fades in on hover. A single `ViewportGizmoOptions` object (see `defaultViewportGizmoOptions`) drives size, placement, colors, opacity, labels, and animation, so the look is restyled without code changes; unset colors resolve from the active theme palette. The widget is pure — it draws through a `Draw` list and leaves applying intents to the host.
