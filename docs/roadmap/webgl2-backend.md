# WebGL2 Backend

- **Created:** 2026-05-21
- **Status:** Planning

## Goal

`packages/renderer-webgl2` implements `renderer-core` against the browser's WebGL2 API. Engine code runs unchanged when the runtime selects a WebGL2 backend instead of WebGPU. Capability-flag-gated features (compute, storage textures, timestamp queries) gracefully degrade or are unavailable.

## Phases

1. **Capability inventory** — for each `RendererCapabilities` flag, decide WebGL2 support: true / false / emulated.
2. **Binding model translation** — WebGPU bind groups → WebGL2 uniform locations + texture units. This is the largest design surface.
3. **Pipeline model** — WebGPU pipelines (immutable) → WebGL2 program + state vector. May need internal caching.
4. **Shader translation** — WGSL → GLSL ES 3.00. Use [Tint](https://dawn.googlesource.com/tint) WASM if available, otherwise hand-translate the first few shaders and revisit.
5. **First render path** — minimal triangle, then minimal mesh, then validation against the WebGPU backend output.
6. **Continuous parity tests** — golden-image tests run against both backends.

## Open questions

- WGSL → GLSL: is there a maintained JS/WASM transpiler we trust, or do we ship a runtime fallback that limits us to a shader dialect we can compile both ways?
- Storage buffers: WebGL2 has none; use uniform buffers or textures-as-storage. Performance impact significant; engine code that wants storage buffers must check the capability flag.
- Indirect draw: not in WebGL2. Engine systems using it must fall back to CPU-side recording.

## Links

- ADR-0003 — renderer HAL
- WebGL2 spec
- Tint compiler
