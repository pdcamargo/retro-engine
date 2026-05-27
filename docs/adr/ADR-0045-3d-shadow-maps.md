# ADR-0045: Phase 10.4 — 3D shadow maps (directional + spot, 2D-array depth atlas)

- **Status:** Accepted
- **Date:** 2026-05-27

## Context

[ADR-0044](ADR-0044-3d-analytic-lights-and-forward-shading.md) shipped analytic 3D lights and simple-forward Cook-Torrance shading: every visible `DirectionalLight3d` / `PointLight3d` / `SpotLight3d` is packed into a fixed-capacity `GpuLights` uniform at `@group(2)`, and `pbr.wgsl` loops them. But nothing occludes light — every fragment is lit by every light with no visibility test, so 3D geometry reads as flat and ungrounded. ADR-0044 itself flagged this: "Shadow maps (10.4) layer on cleanly: the `GpuLights` struct grows per-light shadow metadata and `compute_lighting` gains a shadow factor, mirroring how ADR-0042 added `shadowRow` to ADR-0037."

This ADR seals roadmap §10.4 — shadow maps for **directional and spot** lights. It **extends ADR-0044** the same way Phase 9's ADR-0042 grew ADR-0037: the `GpuLights` struct gains shadow metadata and the BRDF's per-light term gains a shadow multiply, no sealed decision replaced. It also extends ADR-0028/ADR-0038's live binding model additively (`@group(2)` grows from one binding to three). The depth-bias HAL surface (ADR-0029) and render-to-depth-texture (ADR-0028 §9) are consumed as-is; **no new HAL is added.**

Out of scope for this ADR (each with its trigger):

- **Point-light (cube / dual-paraboloid) shadows.** A point light radiates in all directions; one 2D depth map cannot capture its occlusion. The fix is a cube map (6 faces) or dual-paraboloid per point light — a meaningfully larger atlas + projection change. Deferred to keep this first commit tight; the `GpuLights` caster-index mechanism and the atlas already generalise to it (point shadows become additional layers + a cube-sample path in `shadow_factor`). Tracked here under "Not yet done".
- **`NotShadowReceiver`.** `NotShadowCaster` (opt a mesh out of *casting*) ships here as a queue-side filter. Opting a mesh out of *receiving* needs a per-instance flag threaded into the lit pipeline + a branch in `pbr.wgsl`; deferred as a documented follow-on.
- **Camera-following / scene-fit directional frustum.** The directional shadow frustum is a fixed orthographic box around the world origin (configurable extent). It does not follow the camera or fit the visible scene, so casters far from the origin fall outside it. Cascaded shadow maps (§10.5, the next ADR) replace the fixed box with camera-fitted cascades.
- **Mixed-resolution / viewport-tiled atlas.** The atlas is a 2D-array texture (uniform per-layer resolution). Packing variable-resolution tiles into a single 2D texture would need `setViewport` / `setScissorRect`, which the HAL lacks. Tracked in `docs/backlog/render-pass-viewport-scissor.md` (independently useful for split-screen / viewport cameras); not required for shadows and not built here.
- **PCF / soft shadows** (§10.6) — the comparison sampler does 2×2 hardware PCF; configurable multi-tap filtering is the next-next ADR.

## Decision

1. **The shadow atlas is one `depth32float` 2D-ARRAY texture, one layer per shadow caster.** `SHADOW_MAP_SIZE = 1024`, `MAX_SHADOW_CASTERS = 8` layers (~32 MB; both tunable), usage `RENDER_ATTACHMENT | TEXTURE_BINDING`. A 2D-array — not a viewport-tiled single 2D texture — is chosen as the *more scalable* primitive: it needs one bind group regardless of caster count, is the substrate cascades (§10.5) extend into (cascades = more layers), supports variable resolution via multiple arrays, and is fully expressible with today's HAL (`depthOrArrayLayers`, per-layer `createView` with `baseArrayLayer`, depth-only render pass with empty `colorAttachments`, fragment-less pipeline, `texture_depth_2d_array` + `sampler_comparison`). Owned by the `Shadow3dState` render-world resource (lazy `ensure`, `beginFrame` per-frame reset), mirroring `Light2dShadowState`.

2. **`GpuLights` grows a trailing `shadow_view_proj: array<mat4x4<f32>, MAX_SHADOW_CASTERS>`** (buffer 7328 → 7840 B). Each shadowed directional / spot light stores its **caster index** (0..N-1, or `-1`) in a previously-unused field — directional `direction.w`, spot `params.w`. The index doubles as the atlas array layer *and* the `shadow_view_proj` matrix index. Point lights are unchanged. The `@group(2)` layout grows to three bindings: lights uniform `@binding(0)`, shadow atlas (`texture_depth_2d_array`) `@binding(1)`, comparison sampler `@binding(2)`. The layout is built in `GpuLights.ensureInitialised` (no texture needed) so `MaterialPlugin.specialize` can append it to lit pipeline layouts; the bind GROUP is built by `Shadow3dState.ensure` once the atlas + comparison sampler exist.

3. **Per-light depth render into the light's atlas layer.** A new `Shadow3dPass3dNode` (a `ViewNode`) is prepended before `OpaquePass3dNode` in the Core3d sub-graph (injected by `Light3dPlugin`, mirroring how `Light2dPlugin` prepends its shadow node). The atlas is camera-independent (lights + casters are world-space), so it is built once per frame: the first Core3d camera renders it, later cameras skip via a `builtThisFrame` guard. For each shadow-casting light, the node opens a depth-only pass (`colorAttachments: []`, the layer's depth view, clear 1.0), binds that light's light-space view-projection at `@group(0)`, and re-draws every caster batch with a fragment-less depth pipeline. The depth pipeline reuses the mesh geometry layout + the existing `INSTANCE_LAYOUT` (position `@location(0)` + model matrix `@location(8..11)`; normals/uv/inverse-transpose ignored) and carries `depthBias` / `depthBiasSlopeScale` from `Shadow3dSettings`.

4. **Light-space projections are computed CPU-side.** Directional → an orthographic frustum (`mat4.ortho`) of half-extent `Shadow3dSettings.directionalExtent` centered on the world origin, aimed along the light's forward (−Z of `GlobalTransform`). Spot → a perspective frustum (`mat4.perspective`, vertical FOV `2·outerAngle`, far = range) at the light's position along its forward. Both via `wgpu-matrix`. Computed in the extended `light3d-prepare` system (it already iterates the lights), written into `GpuLights.shadow_view_proj` (for shading) and staged on `Shadow3dState`; the `shadow3d-prepare` system flushes them to the per-layer depth-pass uniforms after the atlas GPU resources exist (so the first frame is correct).

5. **Casters: every visible `Mesh3d` casts by default; `NotShadowCaster` opts out.** A `shadow3d-queue` system (`RenderSet.Queue`) iterates visible meshes without `NotShadowCaster`, groups them by mesh handle, packs their world transforms into a shared shadow instance buffer, and records one batch per group with its depth pipeline. The same batches are drawn into every shadow-casting light's layer.

6. **`pbr.wgsl` multiplies each directional / spot light's direct contribution by a `shadow_factor`.** A new `retro_engine::shadow3d` WGSL module (imported after `retro_engine::light3d`) declares the atlas + comparison sampler and `shadow_factor(caster_index, world_pos)`: it projects the world fragment by `shadow_view_proj[index]`, maps clip → atlas UV, and `textureSampleCompare`s the layer with a depth bias. Because `textureSampleCompare` requires uniform control flow, the atlas is sampled unconditionally and the "no shadow" (`index < 0`) / "outside frustum" cases are resolved with `select` afterward. Point lights are unaffected (no shadow term).

7. **Fixed budgets, graceful overflow.** Up to `MAX_SHADOW_CASTERS = 8` shadow-casting lights per frame (directional first, then spot, in visible order); lights beyond the budget get caster index `-1` and render unshadowed. Fixed sizes avoid per-frame atlas / buffer reallocation.

Composition-only. `NotShadowCaster` is a plain marker component; `Shadow3dState` / `Shadow3dSettings` are render-world resources; the shadow build is a graph node + two systems. The HAL is consumed only through `renderer-core` types.

## Consequences

**Easier:**

- Directional and spot lights cast real depth-buffer shadows; moving lights / casters are handled per frame. Browser-verified in `apps/playground` (`?mode=lit`: raised PBR spheres shadow the ground under the sun + spot).
- Cascaded shadow maps (§10.5) layer on cleanly — cascades are additional array layers + per-fragment cascade selection; the atlas, bind group, and `shadow_factor` shape already accommodate them.
- One bind group, one depth target, regardless of caster count — scales without touching the binding model again.
- No GPU capability is required: a render-attachment depth texture + a comparison sampler only (no compute, no storage textures), so the path is WebGL2-reachable.
- The unlit path and point lights are untouched.

**Harder / accepted trade-offs:**

- **Shadow correctness is browser-verified, not headless.** The bun suite covers the CPU surface (light-space matrix build + pack offsets, caster-index packing + budget overflow, the 3-entry `@group(2)` layout, caster collection + `NotShadowCaster` exclusion, pass presence / order) via the capturing renderer; the depth render + comparison sample is validated visually. This was explicit when choosing depth-mapped shadows.
- **Depth-bias tuning is visual.** `depthBias` / `depthBiasSlopeScale` (pipeline) plus a constant compare bias in `shadow_factor` counter acne / peter-panning and can only be tuned in-browser. Exposed via `Shadow3dSettings`.
- **Directional shadows use a fixed origin-centered box** (no camera-follow / scene-fit). Casters outside the box go unshadowed; raise `directionalExtent` or wait for cascades.
- **One light-space matrix is written twice** — into `GpuLights.shadow_view_proj` (shading) and the per-layer depth-pass uniform (rendering). Computed once, written to both; the duplication is 8×64 B.
- **Fixed budget of 8 shadow casters / 1024² per layer (~32 MB).** Overflow degrades gracefully (unshadowed) but silently; both constants are tunable.
- **One render pass per shadow-casting light.** Negligible at this budget; a viewport-tiled single-pass variant would need new HAL (backlogged) and is not warranted.

## Not yet done

- **Point-light (cube / dual-paraboloid) shadows.**
- **`NotShadowReceiver`** (per-instance receive opt-out).
- **Cascaded shadow maps** (§10.5) — camera-fitted directional frustum.
- **PCF / configurable shadow filtering** (§10.6).
- **Mixed-resolution / viewport-tiled atlas** — needs `setViewport` / `setScissorRect` (`docs/backlog/render-pass-viewport-scissor.md`).
- **Change-gated shadow rebuild** — the atlas is re-rendered every frame even when lights / casters are static.

## Implementation

- `packages/engine/src/light3d/shadow-3d.ts` — `Shadow3dState` (2D-array atlas, per-layer views, comparison sampler, depth pipeline cache, per-layer view-proj uniforms + bind groups, caster batches, `ensure` / `beginFrame` / `stageViewProj` / `flushViewProj` / `pipelineFor` / `dispose`); `ShadowCasterBatch`; `SHADOW_MAP_SIZE`, `SHADOW_ATLAS_FORMAT`.
- `packages/engine/src/light3d/shadow-3d-matrices.ts` — `directionalLightViewProj`, `spotLightViewProj`, `assignCasterLayer`.
- `packages/engine/src/light3d/shadow-3d.wgsl.ts` — `SHADOW3D_WGSL` (`retro_engine::shadow3d`: atlas + comparison sampler bindings, `shadow_factor`), `SHADOW3D_DEPTH_WGSL` (standalone depth-render shader).
- `packages/engine/src/light3d/shadow-3d-settings.ts` — `Shadow3dSettings`, `Shadow3dSettingsOptions`.
- `packages/engine/src/light3d/not-shadow-caster.ts` — `NotShadowCaster`.
- `packages/engine/src/light3d/shadow-3d-queue.ts` — `queueShadow3dCasters`, `ShadowCasterQuery`.
- `packages/engine/src/render-graph/shadow-pass-3d-node.ts` — `Shadow3dPass3dNode`, `Shadow3dPass3dLabel`.
- `packages/engine/src/light3d/gpu-lights.ts` (modified) — `MAX_SHADOW_CASTERS`, `NO_SHADOW_CASTER`, grown buffer (7840 B) + 3-entry `@group(2)` layout, `buildShadowBindGroup`, `packShadowViewProj` / `packDirectionalCasterIndex` / `packSpotCasterIndex`; bind group moved out of `ensureInitialised`.
- `packages/engine/src/light3d/light-3d.wgsl.ts` (modified) — `MAX_SHADOW_CASTERS`; `shadow_view_proj` appended to `GpuLights`; `direction.w` / `params.w` documented as caster index.
- `packages/engine/src/light3d/light-3d-plugin.ts` (modified) — registers `retro_engine::shadow3d`; inserts `Shadow3dState` + `Shadow3dSettings`; injects `Shadow3dPass3dNode`; `light3d-prepare` assigns layers + builds light-space matrices; adds `shadow3d-prepare` + `shadow3d-queue`.
- `packages/engine/src/material/pbr.wgsl.ts` (modified) — `#import retro_engine::shadow3d`; directional / spot terms multiplied by `shadow_factor`.
- `packages/engine/src/light3d/index.ts`, `packages/engine/src/render-graph/index.ts`, `packages/engine/src/index.ts` (modified) — re-exports.
- `packages/engine/src/light3d/{shadow-3d-matrices,shadow-3d,not-shadow-caster}.test.ts`, `gpu-lights.test.ts` (extended) — CPU coverage.
- `packages/engine/bench/shadow-3d.bench.ts` + `bench/index.ts` (modified) — light-space matrix build + pack throughput.
- `apps/playground/src/lit-showcase-plugin.ts` (modified) — raised casters over the ground plane for `?mode=lit`.
