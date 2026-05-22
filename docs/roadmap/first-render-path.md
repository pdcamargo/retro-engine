# First Render Path

- **Created:** 2026-05-21
- **Status:** In progress

## Goal

Make the renderer HAL load-bearing by driving a single triangle end-to-end through the entire stack: `apps/playground` → `engine` → `renderer-core` interfaces → `renderer-webgpu` implementation → browser canvas. ADR-0003 anticipates that the HAL "needs to be designed deliberately and will accrete as features need it" and that "some HAL types will likely be refactored once we have the first real render pipeline." This initiative is that refactor. The triangle is the witness; the deliverable is the contract.

We're done when: a render system records a draw against a `RenderContext`, the engine submits a frame per tick, `apps/playground` shows a triangle in a WebGPU-capable browser, and no `GPU*` type leaks past `packages/renderer-webgpu/`.

## Phases

1. **HAL contract expansion** — grow `renderer-core` to cover surface acquisition, shader/pipeline construction, encoder lifecycle, and command-buffer submission. `CommandEncoder.finish()` returns a `CommandBuffer`; `beginRenderPass` takes a `RenderPassDescriptor` with color attachments.
2. **WebGL2 stub catch-up** — mechanically widen the throwing stub in `renderer-webgl2` so the package still typechecks against the new HAL.
3. **WebGPU implementation** — wire every new HAL method through `GPUDevice`/`GPUCanvasContext`/`GPUCommandEncoder`. Hide concrete `GPU*` handles behind symbol-keyed fields; never leak past the package boundary.
4. **Engine render stage** — `App` accepts an optional `canvas`, creates and configures a `Surface`, drives a single main render pass per frame, and invokes render systems with a typed `RenderContext`. `addSystem` gains a typed overload for `'render'`.
5. **Playground consumer** — stand up `apps/playground` (browser-only, no Tauri). A `trianglePlugin` builds an inline-WGSL pipeline at startup and records `pass.draw(3)` on the render stage.

## Open questions

- **Render-stage system signature.** We've split into `SystemFn` (non-render) and `RenderSystemFn` (render). This is a known stopgap — the real fix is Bevy-style system-parameter injection so adding a new stage or a new param kind doesn't keep forcing a new signature alongside the old ones. Tracked in `docs/roadmap/system-params.md`; ADR-0006 will be written there when the shape is locked.
- **Resource ownership boundary.** Today plugins reach pipelines via `app.renderer.createRenderPipeline(...)` and stash the handle in closure state. Once the ECS earns the render path (after archetype storage), pipelines and shader modules likely move to world resources. Decide the migration when there's a second consumer.
- **Pipeline layout.** HAL accepts `layout: 'auto'` only. Explicit `BindGroupLayout` / `PipelineLayout` arrive with the first uniform — almost certainly during the sprite milestone.
- **Surface re-configuration on resize.** WebGPU auto-resizes the swapchain when the canvas backing size changes; we currently just keep `canvas.width/height` in sync via `ResizeObserver`. Confirm this holds for DPR changes and out-of-bounds resizes.

## Links

- ADR-0001 — composition-only ECS/engine; informs the `RenderSystemFn` shape (no base class).
- ADR-0003 — renderer HAL; this initiative pays the cost the ADR's "Consequences" section anticipated.
- ADR-0005 — ECS archetype storage; the ECS is deliberately *not* on the render path in this initiative.
- `docs/roadmap/playground-app.md` — the playground app whose Phase 1 ("Scaffold" + "Dev server") this initiative bootstraps.
- `docs/roadmap/renderer-graph.md` — the render-graph initiative supersedes the "one main pass per frame" assumption once ≥2 passes exist. This initiative produces pass #1.
- `docs/roadmap/studio-imgui.md` — jsimgui integration depends on this initiative landing first ("engine empty frame" is its precondition).
