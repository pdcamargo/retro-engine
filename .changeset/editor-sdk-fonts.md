---
'@retro-engine/editor-sdk': minor
'@retro-engine/renderer-core': minor
'@retro-engine/renderer-webgpu': minor
'@retro-engine/renderer-webgl2': minor
---

feat(editor-sdk): custom font loading (JetBrains Mono default + named faces)

Add font support to the UI layer. `renderer-core`'s `SurfaceOverlay` gains `loadFont(name, data)` (each backend forwards to the binding's font store); `editor-sdk` adds `registerFonts` / `FontSpec`, a `fonts` plugin option (async — bytes are typically fetched) that registers faces, sets the default (`io.FontDefault`) and base size, and `ui.withFont(name, size, body)` to render a scope in a named face (e.g. a pixel display font). Uses Dear ImGui 1.92's size-scalable font path. Font files are supplied by the consumer; none are bundled.
