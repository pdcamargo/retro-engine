# Portable shaders — author WGSL once, run on WebGPU and WebGL2

- **Created:** 2026-06-20
- **Status:** Planning

## Goal

A consumer authors a shader once in WGSL (with the existing `#import`/`#define`/
`#ifdef` system) and it runs on both backends. WebGPU consumes the flattened WGSL
directly; WebGL2 consumes GLSL ES 3.00 generated from the same flattened WGSL by
`naga`, with resource bindings wired from `naga`'s reflection map rather than
hand-maintained a second time. Three build modes exist: `webgpu` (no transpile),
`webgl2` (transpile; fail loudly on capability-gated features), and `universal`
(ship both, select at runtime). Success = the engine's own `StandardMaterial` +
an `ExtendedMaterial` render correctly through a real WebGL2 context from
unmodified WGSL. Decision and spike evidence: ADR-0104.

## Phases

1. **naga-WASM in the toolchain** — `naga` available as a WASM library in the Bun
   build, exposing translation + the reflection map (bindings, samplers, entry
   points). Promote to `docs/backlog/` first.
2. **Shader-asset IR** — define the engine-side shader artifact: flattened WGSL +
   reflected metadata, produced once and consumed by both backends. Inject
   `TARGET_WEBGPU`/`TARGET_WEBGL2` defines at preprocess time.
3. **WebGL2 backend bind-mapping** — build out `renderer-webgl2` (today a stub):
   consume the IR, map `_group_G_binding_B` blocks/samplers to their slots via
   `getUniformBlockIndex`/`uniformBlockBinding`/`getUniformLocation`, realize the
   single `PipelineDescriptor` per ADR-0018.
4. **Capability gate** — `webgl2` builds fail loudly when a shader uses compute /
   storage buffers / storage textures (gated on `RendererCapabilities`); engine
   `retro_engine::*` modules audited to stay translatable or ship per-target
   `#ifdef` variants.
5. **Build modes** — `webgpu` / `webgl2` / `universal` selectable; `universal`
   ships both shader forms and picks the backend at runtime with WebGL2 fallback.
6. **Real-context verification** — compile the generated GLSL ES 3.00 in an actual
   WebGL2/ANGLE context and render `StandardMaterial` + an `ExtendedMaterial`,
   closing the gap ADR-0104 flags (naga-valid ≠ GL-driver-compiled).

## Open questions

- naga-WASM packaging: prebuilt artifact vs. building from the `naga` crate in CI;
  size budget for the `webgl2`/`universal` build. (likely an ADR)
- Where translation runs: studio build step only, engine runtime, or both
  (a browser `universal` build may need runtime translation for user shaders).
- Reflection-map shape as a stable engine type vs. naga's struct passed through.
- Per-target shader variants: how a module declares a hand-written GLSL fallback
  for a construct naga can't lower — convention vs. registry API.
- WebGL2 UBO/sampler-unit limits vs. the lights/shadow/material/AO group count —
  may need binding packing for the heaviest pipelines.

## Links

- Decision: ADR-0104 (portable shaders — WGSL source, GLSL via naga)
- Related ADRs: ADR-0022 (shader preprocessor), ADR-0028 (material system +
  ExtendedMaterial), ADR-0003 / ADR-0018 (renderer HAL + binding model),
  ADR-0001 (capability flags), ADR-0058 (derivative normal mapping)
- Related roadmap: `renderer.md`, `web-build-target.md`
- External references: `naga` (gfx-rs translator, wgpu's WebGL shader path);
  Three.js TSL and Slang as alternative authoring layers considered and deferred
