---
'@retro-engine/ui': minor
---

feat(ui): node borders (UI phase 2c)

UI nodes can draw a border. `UiStyle` gains `borderWidth` (per-side `Edges`, with
the same scalar/partial shorthand as padding/margin) and `borderColor` (linear
RGBA `Vec4`); both reflection-registered on `UiNode`. The overlay prepare pass
emits up to four inset edge quads per node (CSS `border-box`; corners are not
double-covered), painted over the node's own background and behind its children
via the existing depth-first order — no new pipeline, it reuses the UI quad path.
`borderEdgeRects` is the pure, tested edge-geometry helper.

Verified in a real browser (the `sample-game` export's HUD panel and menu
buttons now show outlines). 77 UI tests.
