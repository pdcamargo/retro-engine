---
'@retro-engine/ui': minor
---

feat(ui): in-UI text rendering via a screen-space MSDF overlay (UI phase 2b)

`UiText` nodes now draw their glyphs on screen, positioned within the node's
content box by the flex layout, composited over UI backgrounds.

- `UiText.color` (linear RGBA `Vec4`, default white), reflection-registered.
- `UiTextPipeline` — a screen-space MSDF glyph pipeline reusing the engine's
  glyph layout (`Font.layout`) and font atlas: unit quad + per-instance clip
  rect + atlas UV + `unitRange` + `unorm8x4` color; median-of-RGB coverage with
  `fwidth`-based AA (crisp at any size). Per-atlas bind-group cache.
- `prepareUiText` — lays out each `UiText`, places glyphs at the node's content
  origin, maps them to clip space, and packs them grouped by atlas (one draw
  batch per font). `packUiGlyph` / `computeClipRect`.
- `UiTextPassNode` — a second overlay render-graph node ordered after the UI
  quad pass, drawing the glyph batches to the swapchain with `loadOp: 'load'`.
- `UiRenderPlugin` registers the text pipeline + prepare system + pass node.
  `Fonts` (from `TextPlugin`) is optional — no font store, no UI text drawn.

Verified end-to-end: the `sample-game` export renders a HUD panel with labels
("STATUS", "HP 100  MP 42") crisply inside their colored boxes in a real browser
(Playwright). 61 UI tests + a `ui-text-pack` bench. Per-line alignment, richer
text styling, and true interleaved z-ordering of text vs. later panels remain.
