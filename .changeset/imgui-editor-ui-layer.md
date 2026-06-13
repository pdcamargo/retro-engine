---
'@retro-engine/editor-sdk': minor
'@retro-engine/renderer-core': minor
'@retro-engine/renderer-webgpu': minor
'@retro-engine/renderer-webgl2': minor
---

feat(editor-sdk): immediate-mode UI layer over Dear ImGui (ADR-0072)

Adds `@retro-engine/editor-sdk` with a normalized, typed, tokenized immediate-mode `ui` wrapper over `@mori2003/jsimgui` — the only public UI surface; raw jsimgui stays internal. `renderer-core` gains a backend-neutral `SurfaceOverlay` contract; `renderer-webgpu` and `renderer-webgl2` each implement it (`createImGuiOverlay(renderer)`), with the device-specific draw kept behind the HAL. The overlay backend is selected from the active renderer at runtime (WebGPU-first, WebGL2 reachable), injected at startup, and themed by design tokens. Includes optional window docking (`uiOverlayPlugin({ docking: true })`, `ui.dockSpaceOverViewport`, per-window `dock`) and dock-layout save/restore via `saveLayout`/`loadLayout` and a `layout` option (default layout + consumer-provided persist/restore sinks) so an editor can ship a default layout and persist user changes.
