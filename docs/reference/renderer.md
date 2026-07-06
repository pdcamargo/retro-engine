# Renderer — current state

Covers the rendering HAL (`renderer-core`), backends (`renderer-webgpu`, `renderer-webgl2`), and the
actual renderer, which lives in `packages/engine/src/` (~24 render subsystems) + `packages/gltf`.

**Shape to know up front:** `renderer-core` / `renderer-webgpu` / `renderer-webgl2` are a thin HAL +
one real backend + one stub — they contain **zero rendering features**. The real renderer (render
graph, PBR, sprites, lighting, shadows, IBL, post-FX) is in `packages/engine`. It is a mature,
**forward + post-process** pipeline. The honest gaps: WebGL2 is vaporware, there is no compute path,
no clustered lighting, no bloom/DoF/SSR/volumetrics/atmospheric sky, and no engine-level text.

---

## HAL & capability flags

- ✅ **HAL surface** (`renderer-core`, ADR-0003/0018/0026/0029) — buffers, textures, samplers, shader
  modules, bind-group/pipeline layouts, render pipelines, command/render-pass encoders, surface,
  render targets (surface/texture/view); full vertex/index/texture formats incl. sRGB + HDR
  (`rgba16float`/`rg16float`) + depth/stencil; full blend + depth-stencil (incl. stencil ops + depth
  bias/slope-scale); storage-texture bind entries; `SurfaceOverlay` for immediate-mode UI.
- 🟡 **Capability flags** (`renderer-core/src/capabilities.ts`) — `computeShaders`, `storageTextures`,
  `timestampQueries`, `indirectDraw`, `bgra8UnormStorage`, `baseVertex`, `storageBuffers`. **Declared ≠
  reachable**: `baseVertex` and `storageBuffers` are genuinely used (mesh allocator, joint palette);
  but `computeShaders`/`indirectDraw` are declared `true` on WebGPU with **no HAL surface to use them**
  (no `createComputePipeline`, no dispatch, no `drawIndirect`). All "GPU compute" today (skinning, morph,
  IBL prefilter, AO) runs via render/fragment passes, not compute.
- ❌ **Absent from the HAL** — compute pipelines/passes/dispatch, indirect draw, buffer/texture copy
  commands, dynamic `setViewport`/`setScissorRect` (backlog/render-pass-viewport-scissor.md), MSAA
  resolve target, timestamp/occlusion queries, render bundles, mipmap generation.

## Backends

- ✅ **WebGPU** (`renderer-webgpu`) — thin pass-through to `GPUDevice`; `GPU*` handles hidden behind
  module symbols (never leak past the package, CLAUDE.md §10); real ImGui overlay compositing onto the
  swapchain.
- 🔩 **WebGL2** (`renderer-webgl2`) — **stub**: every method throws "not implemented"; `init()` rejects;
  caps all-false. Only the ImGui overlay is real. Exists to keep the contract visible. **This is a hard
  dependency for several export targets** — see the WebGPU-in-webview constraint below.

## Render graph & frame structure

- ✅ **Render graph** (`engine/src/render-graph/`, ADR-0023) — node/edge registration, cycle detection,
  topo freeze/run, sub-graphs, slots, view-nodes; root `CameraDriverNode` dispatches each camera into
  its sub-graph.
- ✅ **Frame driver** (ADR-0019/0020) — render sets `Extract → Prepare → Queue → PhaseSort` then
  `graph.run` per camera; clear-only fallback when no cameras. Bevy-style render-world/extract.
- ✅ **Default sub-graphs** — Core2d (`Opaque2d → Transparent2d`, painter's by `translation.z`, no depth)
  and Core3d (`Opaque3d`+`AlphaMask3d` front-to-back with depth, then Transparent3d back-to-front).
  Plus 2D-light nodes (shadow/normal-prepass/accumulation/composite) and post-FX nodes.
  🟡 **Forward only** — no deferred/GBuffer path (DeferredPrepass pending, roadmap/renderer.md 12.8).

## Shaders

- ✅ **Shader system** (`engine/src/shader/`, ADR-0022) — WGSL preprocessor (`#define`/`#ifdef`/`#import`
  modules), shader registry, pipeline cache keyed by shader+layout+state, specialized-pipeline helper.
- 🟡 **Portable-shader ambition** (ADR-0104) — WGSL→GLSL via naga for a future WebGL2 backend is a
  decision on paper; **not exercised** (WebGL2 is a stub).
- 🔩 **Shader hot reload** — not done (`shader-registry.ts` notes it; ADR-0022).

## Materials & meshes

- ✅ **3D materials** (`engine/src/material/`, ADR-0028/0058) — `StandardMaterial` = real metallic-roughness
  PBR (Cook-Torrance, base-color/MR/normal/emissive/occlusion, alpha cutoff, **derivative-based normal
  mapping**, no per-vertex tangents), `UnlitMaterial`, `ExtendedMaterial` (user extension); materials-as-assets
  `.remat` (ADR-0107). 🟡 PBR does not write motion vectors (velocity comes from the prepass).
- ✅ **2D materials** (`engine/src/material2d/`, ADR-0035) — `ColorMaterial2d`, `MeshMaterial2d<M>`.
- ✅ **Meshes** (`engine/src/mesh/`, ADR-0024/0025) — `Mesh` asset, `Mesh2d`/`Mesh3d`, bounds, **mesh
  allocator** (shared vertex/index buffers via `baseVertex`, per-mesh fallback on WebGL2), procedural
  primitives (cuboid/sphere/cylinder/cone/capsule/torus/plane/…), Bevy-style `Meshable`.
- ✅ **Images/textures** (`engine/src/image/`, ADR-0030/0106) — `Image` asset + `RenderImage` upload,
  **HDR/RGBE decode**, samplers, HDR offscreen targets.

## Cameras, lighting, shadows

- ✅ **Cameras** (`engine/src/camera/`, ADR-0020/0048/0081) — `Camera2d`/`Camera3d`, perspective+ortho,
  viewport, per-camera clear color, **render layers/masking**, sorted-camera ordering, `MainCamera`,
  TAA jitter, HDR view target.
- ✅ **3D lighting** (`engine/src/light3d/`, ADR-0044) — directional/point/spot + ambient, packed
  `GpuLights` uniform, forward shading. 🟡 **flat light list looped per-fragment — no clustered/tiled
  (Forward+)** (backlog/3d-clustered-forward-plus.md).
- ✅ **3D shadows** (`engine/src/light3d/`, ADR-0045/0046/0047) — depth-array shadow maps
  (directional+spot), **cascaded shadow maps**, PCF (`Hardware2x2`/`Castano13`/`Pcf5x5`),
  `NotShadowCaster`. ❌ point/cube shadows, PCSS, light probes, irradiance volumes, lightmaps.
- ✅ **2D lighting** (`engine/src/light2d/`, ADR-0037/0041/0042/0043) — point/spot/directional/ambient 2D
  lights, accumulation+composite, **segment shadow occluders**, **normal-mapped 2D lighting**.

## Environment, post-processing

- ✅ **Skybox + IBL** (`engine/src/environment/` + `skybox/`, ADR-0105/0106) — cube skybox; **real IBL**:
  equirect→cube, GPU prefilter (irradiance + roughness-mipped specular + BRDF LUT) via render passes,
  split-sum in the shared PBR path. (A stale `pbr.wgsl.ts` comment calls IBL "future" — it ships.)
- ✅ **Post-FX** (each ADR + WGSL + graph node + plugin): HDR + **tonemapping** (ADR-0048/0049), **prepass**
  (depth + motion vectors, ADR-0050/0051), **motion blur** (ADR-0052), **TAA** (ADR-0053), **SSAO**
  (fragment GTAO, WebGL2-reachable, ADR-0054).
- ❌ **Absent post-FX** — bloom, depth of field, SSR, SSGI, volumetrics/god rays, FXAA/SMAA, chromatic
  aberration, vignette, color grading/LUT (tony_mc_mapface backlogged), auto-exposure, OIT.

## Geometry pipeline (instancing, culling, batching)

- ✅ **Instancing** (`engine/src/instance/`, ADR-0038/0039) — growable instance store, retained draw order,
  per-instance model + inverse-transpose in instance-step attributes.
- ✅ **Culling** (`engine/src/visibility/`, ADR-0021/0040) — CPU frustum culling, hierarchical visibility
  propagation, event-driven change-gated prepares. ❌ GPU culling / occlusion queries (no compute path).
  🟡 `VisibilityRange`/LOD is a seed only (backlog/visibility-range.md).
- ✅ **Sorting/batching** — per-phase sort (3D depth order, 2D painter's); material instance batching,
  Z-aware sprite batching, light batching, skinned/morph batching.

## 2D, models, debug

- ✅ **Sprites** (`engine/src/sprite/`, ADR-0031/0032/0033/0034/0036) — sprite component + pipeline,
  **Z-aware batching**, instanced buffers, **texture atlas layout**, **atlas animation**, **9-slice**.
- ❌ **Engine-facing text** — no glyph/font-atlas/MSDF/text subsystem. On-screen text today is only the
  ImGui editor overlay (editor UI, not an engine feature). A game-facing text renderer does not exist.
- ✅ **glTF/GLB import** (`packages/gltf`, ADR-0057/0059) — GLB+glTF parse, scene instantiation, animation
  mapping, image decode, auto-retarget on import. (See [`assets.md`](assets.md).)
- ✅ **GPU skinning & morph** — see [`animation.md`](animation.md) (ADR-0114/0115/0129).
- ✅ **Gizmos & grid** (`engine/src/gizmos/` + `grid/`, ADR-0075/0076) — immediate-mode debug draw
  (line/mesh) via a dedicated pass; analytic infinite editor grid (2D+3D).

## ❌ / ⚠️ Absent vs a mature renderer

- WebGL2 backend (stub) · compute path (no GPU culling/particles/light clustering) · clustered forward+ ·
  deferred/visibility-buffer · bloom/DoF/SSR/SSGI/volumetrics/atmospheric sky · FXAA/SMAA · engine text ·
  particles · decals · terrain · water · indirect/GPU-driven · render bundles · MSAA resolve · timestamp/
  occlusion queries · dynamic viewport/scissor · mipmap gen · texture compression (BCn/ASTC/ETC).

## ⚠️ The WebGPU-in-webview constraint (why WebGL2 is a hard dependency)

The studio and exported native games run in each platform's **system webview**, which does not
uniformly support WebGPU (researched, 2025–2026):

| Runtime | Webview | WebGPU |
|---|---|---|
| Web (modern browser) | Chrome/Edge/Firefox/Safari | ✅ |
| Tauri Windows | WebView2 (Chromium) | ✅ |
| Tauri macOS | WKWebView | ⚠️ only macOS 26+ |
| Tauri iOS | WKWebView | ⚠️ only iOS 26+ |
| Tauri Linux | WebKitGTK | ❌ |
| Tauri Android | System WebView | ❌ |

Consequences: the **WebGL2 backend is required**, not optional, to ship to Linux/Android and to
older Apple OSes — it gates those export targets. The same constraint applies to the **studio's own
live preview** on Linux and pre-26 macOS. Every WebGPU-only capability (compute, storage textures,
timestamp queries, indirect draw) must stay behind a `RendererCapabilities` flag (CLAUDE.md §5.4/§10)
so a WebGL2 target cannot silently pull one in.

Forward-looking work: [`../roadmap/MASTER-ROADMAP.md`](../roadmap/MASTER-ROADMAP.md) (RENDERER section)
and roadmap/portable-shaders.md.
