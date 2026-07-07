---
'@retro-engine/renderer-webgpu': minor
---

refactor(renderer-webgpu)!: move createImGuiOverlay to the /imgui subpath

`createImGuiOverlay` pulls the editor-only `@mori2003/jsimgui` (a multi-MB WASM
library) and was re-exported from the package index — which is on the shipped-game
path (`bootWebGame` imports `createWebGPURenderer` from it), so ImGui leaked into
every exported game bundle. It now lives at the `@retro-engine/renderer-webgpu/imgui`
subpath, keeping it out of the index's module graph.

**Breaking:** import `createImGuiOverlay` (and `ImGuiOverlayOptions`) from
`@retro-engine/renderer-webgpu/imgui` instead of the package root. Editor / dev
hosts (studio, playground) are updated; game code that only uses
`createWebGPURenderer` needs no change and no longer bundles ImGui.

Verified: the `@retro-engine/sample-game` web export's `main.js` contains zero
`imgui` references after the change; studio + playground still bundle it via the
subpath.
