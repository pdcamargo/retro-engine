# ADR-0154: In-game UI renders via a once-per-frame screen-space overlay pass

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

ADR-0150 established the in-game UI package and said UI "draws through the
engine's 2D pipeline — background quads + borders (a UI material/pipeline) and
text via the ADR-0149 glyph path." Layout (`ComputedLayout`) is now produced in
**logical pixels**, top-left origin, y-down, relative to the `UiViewport`. This
ADR fixes *how and where in the frame* those boxes are actually drawn.

The engine's 2D draw path (sprites, text) pushes `PhaseItem2d`s into
`ViewPhases2d`, consumed by the Core2d sub-graph's pass nodes **once per active
2D camera**, with that camera's view/projection bound. UI does not fit that shape:

- UI is **screen-space**, not world-space — it has no camera, no view matrix,
  and must not scroll/zoom with any game camera.
- UI is a **single overlay for the whole frame**, composited on top of
  everything the cameras drew — not replicated per camera.
- A game may have zero 2D cameras (a pure-3D game with a HUD) yet still needs UI.

## Decision

Render in-game UI from a **new top-level `RenderGraph` node**, `UiPassNode`
(label `retro_ui::ui_pass`), registered by `UiRenderPlugin.finish()` with an edge
`CameraDriverLabel → UiPassLabel` so it runs **once per frame, after** every
camera sub-graph has submitted.

- The node owns its own command encoder and acquires the swapchain view
  (`app.getSurface().getCurrentTextureView()`), opening a render pass with
  **`loadOp: 'load'`** so it composites on top of the scene the cameras drew,
  then submits. (This mirrors the engine's no-camera fallback path; GPU executes
  submits in order.)
- Geometry is **instanced screen-space quads**. A `RenderSet.Prepare` system
  walks `UiNode` + `ComputedLayout` entities with a `backgroundColor`, maps each
  box from logical pixels (in `UiViewport` space) to clip space on the CPU
  (`clipX = 2·x/W − 1`, `clipY = 1 − 2·y/H`), and packs `(clipRect, rgba)` per
  instance. Because the mapping uses the same `UiViewport` the layout ran
  against, it is resolution/DPR-independent — no view matrix, no bind groups.
- A small system syncs `UiViewport` to the surface's **logical** size each frame
  (physical ÷ `devicePixelRatio`) so layout targets the real canvas and the UI
  fills it; headless (no `window`) keeps the default.
- Draw order is entity/prepare order for now (painter's, back-to-front by
  authoring). Explicit z-index is a later sub-phase.

The render layer lives in **`@retro-engine/ui`** (it reads UI components; the
engine must not depend on `ui`), as a separate `UiRenderPlugin` so `UiPlugin`
stays headless/GPU-free. `ui` gains `@retro-engine/math` (colors) and
`@retro-engine/renderer-core` (HAL types) dependencies, consistent with ADR-0150.

This first slice draws **solid background quads only**. Borders, corner radius,
in-UI text (through the ADR-0149 glyph path), clipping, and z-index are
subsequent sub-phases behind the same node.

## Consequences

- UI composites correctly over any scene, with or without 2D cameras, exactly
  once per frame — the per-camera phase model's wrong shape is avoided.
- Screen-space mapping through `UiViewport` keeps the GPU path free of camera
  uniforms and bind groups: a unit quad + a per-instance clip rect + color is the
  whole vertex input. Cheap and simple to extend.
- A second `getCurrentTextureView()` in the same frame relies on the swapchain
  returning the same texture for the frame (WebGPU semantics); the surface view
  is not retained across frames.
- Painter-order (no z-index yet) is a deliberate first cut, tracked in the
  roadmap — not a scope cut (§12).
- Because it is its own node + plugin, UI rendering is fully opt-in and does not
  perturb the sprite/text phase path or headless layout.

## Implementation

- `packages/ui/src/render/ui-quad.wgsl.ts` — screen-space quad shader (clip-rect + color).
- `packages/ui/src/render/ui-instance.ts` — instance byte layout + `packUiQuad`.
- `packages/ui/src/render/ui-pipeline.ts` — `UiPipeline` (lazy pipeline + quad/instance buffers).
- `packages/ui/src/render/ui-prepare.ts` — clip-space mapping + instance packing from `ComputedLayout`.
- `packages/ui/src/render/ui-pass-node.ts` — `UiPassNode` / `UiPassLabel` (own encoder, `loadOp:'load'`, submit).
- `packages/ui/src/render/ui-render-plugin.ts` — `UiRenderPlugin` (prepare system, viewport sync, node registration in `finish`).
- `packages/ui/src/ui-style.ts` — `backgroundColor` on `UiStyle`.
