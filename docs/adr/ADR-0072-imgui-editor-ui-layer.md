# ADR-0072: ImGui editor UI layer — normalized wrapper + backend-neutral surface overlay

- **Status:** Accepted
- **Date:** 2026-06-12

## Context

The engine has a renderer HAL (ADR-0003/0018) with a WebGPU backend and a WebGL2 stub behind `renderer-core`, injected at `App` startup (`AppOptions.renderer`). It has no UI layer yet. The studio — and consumers building their own editors — need one. Dear ImGui's immediate-mode model fits tooling, and `@mori2003/jsimgui` (Dear ImGui v1.92.8-docking) binds it for the web with WebGL/WebGL2/WebGPU backends. Engine direction is WebGPU-first, WebGL2-reachable (§5.3/§5.4), and `GPU*` types are confined to `renderer-webgpu` (§10).

The binding's shape forces the architecture. `@mori2003/jsimgui` exposes two namespaces: `ImGui` (immediate-mode widgets) and `ImGuiImplWeb` (platform glue — `Init`, `BeginRender`, `EndRender`, `RegisterTexture`, fonts). Init and the per-frame draw are backend-specific: WebGPU is `Init({ canvas, device })` then `EndRender(passEncoder)` recording into a caller-owned `GPURenderPassEncoder`; WebGL2 is `Init({ canvas })` then `EndRender()` into the bound framebuffer. The `GPUDevice` and the raw render pass live behind module-private symbols in `renderer-webgpu` — code outside it cannot reach them, so the device-specific draw must live inside the backend package. Widgets, by contrast, are backend-neutral.

## Decision

1. **A normalized, typed, immediate-mode wrapper (`ui.*`) in a new `@retro-engine/editor-sdk` is the only public UI surface.** It keeps ImGui's grain — widgets return values / take-and-return edited state — while centralizing theming through design tokens. The raw binding is never exposed to consumers. This `ui` surface is a first-class API for consumer-built editors, not an internal helper.

2. **The backend draw is abstracted behind a backend-neutral `SurfaceOverlay` contract in `renderer-core`** — `init(canvas)`, `beginFrame()`, `endFrame(surface)`, `destroy()` — naming neither ImGui nor any `GPU*` type. The implicit bracket is immediate-mode: between `beginFrame` and `endFrame` the caller issues the frame's UI draw calls against the shared context. Each renderer backend implements the contract (`createImGuiOverlay(renderer)`), reaching its own device/pass through its module-private symbols; the overlay is injected at startup the same way the renderer is. ImGui is the first implementation; the contract permits a future non-ImGui overlay.

3. **jsimgui is split along its two namespaces:** `ImGui` (widgets) lives in `editor-sdk`; `ImGuiImplWeb` (platform glue) lives in the backend packages. A single pinned, hoisted jsimgui version guarantees one shared wasm instance, so widget state authored through `editor-sdk` and the draw submitted by the backend operate on the same context.

4. **The WebGPU overlay composites through a storage-format view, not the engine's sRGB view.** The surface configures an sRGB view for the engine's pass (`srgbVariantOf`), but jsimgui builds its pipeline for the swapchain's storage format. The overlay reads the raw `GPUCanvasContext` (exposed via an internal symbol) and creates a default-format view of the same current texture, with `loadOp: 'load'`, so the engine's frame is preserved beneath and the attachment format matches the UI pipeline.

5. **No engine-package change.** The overlay runs in the render `Cleanup` set (after the main render is submitted) via a plugin that closes over the `App` and reads the existing public `App.getSurface()`. The plugin gates `ready()` on the async overlay init.

6. **The overlay backend is selected from the active renderer at runtime, never hardcoded.** Both backends implement the contract, so the WebGL2 path is reachable by construction; it is unexercised end-to-end only because the WebGL2 renderer itself is still a stub. Tokens are a typed TS module (canonical, consumer-facing); a design-tool CSS-variable export is the author-time input mapped into it. A declarative/CSS-like UI system over the immediate-mode core is deferred to the roadmap; the token layer is built to be reused by it.

## Consequences

- `renderer-core` gains one neutral interface and stays a leaf (no jsimgui, no `GPU*`). `renderer-webgpu` exposes the post-init `GPUDevice` and the surface's `GPUCanvasContext` through internal symbols only — the public `Renderer`/`Surface` shapes are unchanged — and gains a jsimgui dependency.
- Both backend packages depend on jsimgui, so any bundle that includes a backend includes jsimgui (the studio bundle does, even though it does not yet use the overlay). Making the overlay a subpath export so it is opt-in is a tracked follow-up, not done here.
- `@mori2003/jsimgui@0.14.0` ships a packaging bug — `imgui.js` imports `./loader-freetype-extensions.js` but ships `loader-extensions-freetype.js`. Only the freetype+extensions branch (which the default truetype path never takes) is affected at runtime, but static bundlers (bun, esbuild) resolve every branch and fail. Fixed with a committed `bun` patch (`patches/`), pinned to 0.14.0; downgrading to 0.13.0 was rejected because its API (const `ImGuiImplWeb`, no runtime enum consts) differs from the surface this layer is written against.
- Correctness rests on a single wasm instance across the two import sites; a duplicate instance would render nothing. Pinning one version and validating end-to-end (a window must actually draw) is the guard.
- No bench: the wrapper is a thin per-frame passthrough into jsimgui's own draw, not an algorithm whose cost scales with content (§11).

## Implementation

- `packages/renderer-core/src/surface-overlay.ts` — `SurfaceOverlay`
- `packages/renderer-webgpu/src/symbols.ts` — `GPU_DEVICE`, `GPU_SURFACE_CONTEXT`, `InternalRenderer`, `InternalSurface`
- `packages/renderer-webgpu/src/{index.ts, surface.ts}` — device/context exposed via the internal symbols
- `packages/renderer-webgpu/src/imgui-overlay.ts` — `createImGuiOverlay`
- `packages/renderer-webgl2/src/imgui-overlay.ts` — `createImGuiOverlay`
- `packages/editor-sdk/src/{ui.ts, tokens.ts, theme.ts, apply-theme.ts, plugin.ts, units.ts, index.ts}` — `ui`, `Ui`, `ThemeTokens`, `defaultTokens`, `resolveTheme`, `applyTheme`, `uiOverlayPlugin`, `UiOverlayPlugin`, `UiLayoutOptions`
- `packages/editor-sdk/src/docking.ts` — `enableDocking`, `isDockingEnabled` (and `Ui.dockSpaceOverViewport` / `WindowOptions.dock` in `ui.ts`)
- `packages/editor-sdk/src/layout.ts` — `saveLayout`, `loadLayout`, `flushLayoutChange` (dock-layout `ini` save/restore)
- `patches/@mori2003%2Fjsimgui@0.14.0.patch` — loader filename fix
- `apps/playground/src/imgui-showcase-plugin.ts` — `?mode=imgui` proving ground
