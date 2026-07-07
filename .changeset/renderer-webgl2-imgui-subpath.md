---
'@retro-engine/renderer-webgl2': minor
---

refactor(renderer-webgl2): move createImGuiOverlay to the /imgui subpath

Mirrors the WebGPU change: `createImGuiOverlay` (which pulls the editor-only
`@mori2003/jsimgui` multi-MB WASM) moves from the package index to the
`@retro-engine/renderer-webgl2/imgui` subpath, so a future WebGL2 game bundle
(`bootWebGame` → the WebGL2 renderer factory) never drags ImGui in. No consumer
imports it yet, so this is pre-emptive hygiene — import `createImGuiOverlay` from
`@retro-engine/renderer-webgl2/imgui` when the WebGL2 studio/editor path lands.
