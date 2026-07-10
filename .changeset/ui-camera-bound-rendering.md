---
'@retro-engine/ui': minor
---

feat(ui): camera/target-bound UI rendering (ADR-0174)

The UI passes now render into a camera's render target instead of always
overlaying the swapchain, so in-game UI can be composited into an offscreen
camera texture (e.g. the studio's Game viewport, render-to-texture UI).

- New `UiCamera` marker component: attach it to the camera whose target should
  host the UI. The UI renders into that camera's resolved target (swapchain for a
  primary camera, texture for a texture camera) and `UiViewport` is sized to it.
  At most one UI camera is honored per frame (a main camera wins, else the first
  in dispatch order).
- New `UiRenderPluginOptions.overlayWhenNoCamera` (default `true`): with no
  `UiCamera` the UI falls back to the previous full-surface overlay, so existing
  games are unchanged. Hosts rendering into offscreen textures pass `false`.
- The UI pipelines are now specialized on the **target's** color format rather
  than the surface format.
- New exports: `UiCamera`, `UiRenderTargetState`, `pickUiCameraView`,
  `uiTargetView`, `UiRenderPluginOptions`. The internal prepare helpers
  (`prepareUiQuads` / `prepareUiImages` / `prepareUiText`) take additional
  arguments (target format, and a default-font handle for text).

Also:

- `UiText` / `Text` with no explicit font now fall back to the engine's built-in
  default font (see the engine changeset), so text renders without a font asset.
- Assigning `UiNode.style` now normalizes the value through `makeStyle`, so a
  partial style (e.g. from scene/reflection decode or a hand-built object) is
  completed with defaults. This fixes a bug where a UiNode decoded from partial
  data laid out to `NaN` size and never rendered.
