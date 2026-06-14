---
'@retro-engine/renderer-webgpu': minor
---

feat(renderer-webgpu): expose `GPU_TEXTURE` / `GPU_VIEW` and the `InternalTexture` / `InternalTextureView` types

Per ADR-0074, the WebGPU backend now re-exports the internal symbols that reach the raw `GPUTexture` / `GPUTextureView` behind a HAL `Texture` / `TextureView`. This is a deliberate seam for a host that drives an external GPU library directly — e.g. the studio handing an offscreen render-target texture to jsimgui's `ImGuiImplWeb.RegisterTexture` so the engine's render shows inside an ImGui panel. `GPU*` types still never appear on the public HAL surface; consumers reach the handle explicitly through the exported symbol.
