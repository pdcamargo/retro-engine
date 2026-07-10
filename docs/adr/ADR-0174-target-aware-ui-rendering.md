# ADR-0174: Target-aware (camera-bound) UI rendering

- **Status:** Accepted
- **Date:** 2026-07-08

## Context

The in-game UI (`@retro-engine/ui`) rendered as a single, global, screen-space
overlay bound to the **swapchain**: `UiRenderPlugin.finish()` added three
top-level render-graph nodes (quads → images → text) chained after
`CameraDriverLabel`, and each drew to `surface.getCurrentTextureView()` with
`loadOp: 'load'`, once per frame, with no camera or render-target awareness.
`UiViewport` (the logical layout size) was synced to the whole surface, and
layout mapped straight into full-swapchain clip space. In a real game this is
correct: the surface *is* the game output, so the overlay composites over the
game camera.

The studio does **not** render to the swapchain. Each viewport (Scene tab =
editor camera, Game tab = the game "Main Camera") renders into its own
**offscreen texture** shown as an ImGui image; the game camera's target is
redirected to the Game-tab texture every frame (`apps/studio` `scene-bootstrap`).
Nothing authored targets the swapchain except a clear-only camera; the ImGui
editor chrome composites last.

Consequently the UI overlay could not appear inside either viewport panel — a
global swapchain overlay draws across the whole window (behind the chrome), never
into a camera's offscreen texture. Making in-game UI visible in the editor (P0:
the Game tab) requires the UI renderer to draw into a **camera's render target**,
sized to that target, rather than the swapchain.

## Decision

UI rendering becomes **camera/target-bound** rather than a global swapchain
overlay:

- A new **`UiCamera`** marker component opts a camera into hosting the UI. The UI
  renders into that camera's already-resolved render target (`CameraView.target`
  from `SortedCameras`) — the swapchain for a primary camera, the offscreen
  texture for a texture camera — with no re-resolving. It therefore follows the
  studio's per-frame Game-tab retarget automatically.
- `UiViewport` is sized from the **UI camera's resolved target** (logical size =
  target pixels ÷ device-pixel-ratio), and the UI render pipelines are specialized
  on the **target's** color format (not the surface format).
- Resolution happens in a `RenderSet.Prepare` system (`ui-viewport-sync`) ordered
  after `camera-prepare` and before the UI prepare steps; it publishes the chosen
  target into a per-frame `UiRenderTargetState` resource the pass nodes read.
- Backward compatibility is preserved by a `UiRenderPlugin` option
  `overlayWhenNoCamera` (default **true**): with no `UiCamera` present the UI
  falls back to the full-surface overlay, exactly as before. Hosts that render
  into offscreen textures (the studio) pass `false`, so the UI simply does not
  draw when no `UiCamera` target exists — never over the host's own surface.

The studio adds `UiPlugin` + `UiRenderPlugin({ overlayWhenNoCamera: false })`
(only if the loaded project didn't already add them) and ensures the game "Main
Camera" carries `UiCamera`, so in-game UI renders into the Game-tab texture and
is visible while authoring.

## Consequences

- In-game UI now renders inside the studio **Game tab** and into any offscreen
  camera target, enabling render-to-texture UI and (future) split-screen / picture
  cameras. The render pipelines follow the target's format, so a target whose
  format differs from the swapchain no longer mis-renders.
- Existing games are unaffected: with no `UiCamera` the default overlay path is
  bit-for-bit the previous behavior. A game may opt into camera-bound UI by adding
  `UiCamera` to its 2D/UI camera.
- `UiViewport` is now a property of the chosen UI camera's target rather than the
  window. Layout runs in `postUpdate` and reads `UiViewport` sized by the previous
  frame's `Prepare`, so a live viewport **resize** shows a one-frame layout lag
  that self-corrects; on a steady-state frame there is no discrepancy.
- The UI is still a single logical viewport: exactly **one** UI camera is honored
  (if several are marked, the one that is also `MainCamera` wins, else the first
  in dispatch order). Per-camera distinct UI layouts (truly multiple simultaneous
  UI viewports) remain future work, tracked separately.
- Rendering the (screen-space) UI in the **Scene tab** is deliberately not done
  here; the Scene camera is a free-fly authoring view. World-space UI and a
  Unity-style scene-view canvas are a later initiative.

## Implementation

- `packages/ui/src/ui-camera.ts` — `UiCamera` marker component.
- `packages/ui/src/render/ui-render-target.ts` — `UiRenderTargetState` resource;
  `resolveUiRenderTarget` (picks the UI camera view from `SortedCameras`).
- `packages/ui/src/render/ui-render-plugin.ts` — `UiRenderPlugin` (+
  `UiRenderPluginOptions.overlayWhenNoCamera`); `ui-viewport-sync` moved to
  `RenderSet.Prepare`.
- `packages/ui/src/render/ui-pass-node.ts`, `ui-image-pass-node.ts`,
  `ui-text-pass-node.ts` — render into `UiRenderTargetState` view.
- `packages/ui/src/render/ui-prepare.ts`, `ui-image-prepare.ts`,
  `ui-text-prepare.ts` — pipelines specialized on the UI target format.
- `packages/ui/src/register-components.ts` — registers `UiCamera`.
- `apps/studio/src/scene-bootstrap.ts` — adds `UiPlugin` + `UiRenderPlugin`,
  ensures `MainCamera` carries `UiCamera`.
- `apps/studio/src/composer/composer-catalog.ts` — `UiCamera` metadata.
