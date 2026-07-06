---
'@retro-engine/ui': minor
---

feat(ui): screen-space UI overlay rendering — background quads (UI phase 2a)

In-game UI now draws on screen. A `UiRenderPlugin` composites `UiNode`
backgrounds over the rendered scene through a once-per-frame screen-space overlay
pass (ADR-0154).

- `UiStyle.backgroundColor` (linear RGBA `Vec4`, optional) — a paint property
  layout ignores and the renderer fills; reflection-registered on `UiNode`.
- `UiPipeline` — an alpha-blended, camera-free quad pipeline (unit quad +
  per-instance clip rect + `unorm8x4` color; no bind groups — the rect is mapped
  to clip space on the CPU). `computeClipRect` / `packUiQuad` / `packUiColor`.
- `UiPassNode` (`UiPassLabel`) — a top-level render-graph node registered after
  the camera driver; owns its encoder and draws to the swapchain with
  `loadOp: 'load'` so UI composites over the scene, once per frame.
- `UiRenderPlugin` — inserts the pipeline, syncs `UiViewport` to the canvas
  logical size, runs the prepare pass (maps `ComputedLayout` → clip-space
  instances, painted in the layout's depth-first `order` so children draw over
  their parent), and registers the node in `finish`. Headless-safe (no surface →
  no-op).
- `ComputedLayout.order` — depth-first paint order stamped by the layout pass.

`@retro-engine/ui` now depends on `@retro-engine/math` (colors) and
`@retro-engine/renderer-core` (HAL types), per ADR-0150.

Verified end-to-end: the `sample-game` web export renders a nested flex HUD panel
(translucent panel + orange title bar + green content) correctly composited over
the scene in a real browser (Playwright). Borders, corner radius, in-UI text, and
z-index are subsequent sub-phases.
