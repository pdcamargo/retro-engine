# ADR-0104: Portable shaders — WGSL is the single source, GLSL ES 3.00 is generated via naga

- **Status:** Accepted
- **Date:** 2026-06-20

## Context

The engine targets both WebGPU and WebGL2 (ADR-0001, ADR-0003). Today a consumer
authors WGSL and it runs only on the WebGPU backend; a WebGL2 build would force
the author to hand-write a second GLSL shader and a second resource-binding path
for every material. A single source that builds for either API — or a universal
build that picks at runtime — is not currently possible.

A spike (2026-06-20) settled whether this is achievable for *our actual shaders*,
not toy ones. It flattened the real `retro_engine::pbr` module through the real
`preprocessWgsl` (ADR-0022) with `view`/`light3d`/`shadow3d`/`prepass` inlined,
plus a faithful cel-shade `ExtendedMaterial` (ADR-0028) that imports the base and
reuses its `lit`/`fresnel_schlick` helpers and an authored loop. Every variant was
fed through `naga` 29.0.3 targeting GLSL ES 3.00 (`--profile es300`).

Result: **12/12 entry points converted to valid GLSL ES 3.00 with zero
`#extension` directives** (pure core WebGL2). The constructs most likely to fail
all translated idiomatically: comparison shadow sampling on a depth-array
(`sampler2DArrayShadow` + `texture(s, vec4(uv, layer, ref))`), derivative normal
mapping (`dpdx/dpdy` → `dFdx/dFdy`, ADR-0058), `textureSampleLevel`/
`textureDimensions` → `textureLod`/`textureSize`, multiple render targets for the
motion-vector prepass, `std140` uniform blocks, and cross-module function reuse
through the preprocessor's flat-global inlining.

## Decision

- **WGSL is the single shader source of truth.** Consumers author one shader.
  The existing `#import` / `#define` / `#ifdef` preprocessor (ADR-0022) runs
  unchanged and remains entirely upstream of the API boundary: it flattens
  modules to one valid WGSL string, which is the single artifact handed to the
  translator.
- **The WebGL2 backend consumes GLSL ES 3.00 generated from that flattened WGSL
  by `naga`.** WebGPU consumes the flattened WGSL directly, as today. `naga` is
  the same translator wgpu/Firefox ship for their WebGL backend; we adopt it
  rather than inventing a language or a second authoring surface.
- **Resource binding is reflection-driven, authored once.** GLSL ES 3.00 forbids
  `layout(binding=N)` on UBOs/samplers, so `naga` omits it and names each resource
  by origin (`_group_G_binding_B`, block `…_block_NStage`). The WebGL2 backend
  reads `naga`'s reflection map at pipeline-creation and binds each block/sampler
  back to the slot its original `@group`/`@binding` implies
  (`getUniformBlockIndex`/`uniformBlockBinding`, `getUniformLocation`). The author
  declares bindings once, in WGSL; the second wiring is generated, never written.
- **The translatable subset is enforced by capability flags, not hope.** WGSL
  features WebGL2 cannot express — compute, storage buffers, storage textures —
  do not translate and must fail loudly at build time for the WebGL2 target,
  gated on `RendererCapabilities` (ADR-0001 §5.4). None of the material/PBR path
  uses them, which is why the spike passed; the boundary is real and named.
- **Engine-authored `retro_engine::*` modules carry the portability burden, not
  the consumer.** They stay within the ES-3.00-translatable subset, or ship a
  hand-written per-target variant via a `#ifdef TARGET_WEBGL2` / `TARGET_WEBGPU`
  define injected at preprocess time. The game author keeps writing
  `#import retro_engine::pbr` exactly as today.

## Consequences

- One shader, both backends, with the binding wiring generated from reflection
  rather than hand-maintained twice. A `universal` build can ship both forms and
  select at runtime; a `webgl2` build is finally reachable from existing content.
- `naga` enters the toolchain (as a WASM library, not the CLI — the library
  exposes the reflection map the CLI only hints at through naming). This adds a
  build-time translation stage and a WASM dependency to the WebGL2 path.
- The engine accepts an ongoing obligation: every new `retro_engine::*` shader
  module must stay translatable or provide a per-target variant. A shader that
  uses a capability-gated feature is correctly unbuildable for WebGL2, not
  silently broken.
- `naga`-valid is not yet GL-driver-compiled. The es300 output is wgpu's
  production WebGL path, but final confidence requires compiling in a real
  WebGL2/ANGLE context — tracked as a phase in the roadmap, not assumed here.
- This neither adopts Slang nor builds a TSL-style host-language DSL. Both remain
  open future layers: a DSL would emit WGSL and flow through this same pipe, so
  this decision does not foreclose it.

## Implementation

_(none yet — tracked in `docs/roadmap/portable-shaders.md`; spike artifacts were
throwaway and live outside the repo. Builds on ADR-0022 (preprocessor), ADR-0028
(material composition), ADR-0003/ADR-0018 (renderer HAL + binding model),
ADR-0001 (capability flags), ADR-0058 (derivative normal mapping).)_
