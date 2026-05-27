# ADR-0044: Phase 10.1/10.3 — 3D analytic lights, `GpuLights` uniform, simple-forward shading

- **Status:** Accepted
- **Date:** 2026-05-27

## Context

Renderer-roadmap Phase 10 (`docs/roadmap/renderer.md`) ships 3D lighting. Today `StandardMaterial`'s shader (`packages/engine/src/material/pbr.wgsl.ts`) carries real Cook-Torrance PBR math (`distribution_ggx`, `geometry_smith`, `fresnel_schlick`, energy-conserving diffuse/specular split) but evaluates it against a **single hardcoded directional light** and a constant `vec3(0.03)` ambient. There is no light component, no per-frame light uniform, and no way for a scene to place lights. 3D meshes are unlit in practice. ADR-0028 §14 anticipated exactly this: "When Phase 10's `Lights` uniform lands, this shader gains a light bind group and the inner light loop replaces the hardcoded values."

This ADR seals Phase 10.1 (the four light kinds) and the `GpuLights`/`prepare_lights` half of 10.3 — the first end-to-end slice. It mirrors Phase 9 (2D lighting): ADR-0037 seeded the foundation and ADR-0041/0042/0043 extended it without supersession. Phase 10's later ADRs (shadow maps 10.4, cascades 10.5, PCF 10.6) extend **this** ADR the same way.

Out of scope for this ADR (each with its trigger):

- **Clustered forward+ (roadmap 10.2 + the `assign_objects_to_clusters` half of 10.3).** Tracked in `docs/backlog/3d-clustered-forward-plus.md`. This ADR ships **simple forward**: the fragment shader loops over every light in a fixed-capacity uniform. That path is `O(fragments × lights)` and is the correct first slice — the light components, `GpuLights` data, and BRDF integration are identical whether clustering is added later or not; clustering only changes *which* lights a fragment iterates. Simple forward also doubles as the eventual WebGL2 fallback (uniform buffers only — no storage buffers, no compute, no capability flag). Clustering is deferred for sequencing/cost reasons (it commits the engine to an SSBO dependency + a new `storageBuffers` capability flag + a clean WebGL2-refusal path), **not** because of any assumption about how many lights scenes "need".
- **Shadow maps** — Phase 10.4. The depth-bias HAL surface (ADR-0029) and per-camera depth textures (ADR-0028 §9) are ready; the shadow prepass + sampling land in the next ADR. The `GpuLights` per-light structs gain shadow metadata there.
- **IBL / environment maps** — Phase 10.7. Gated on the asset system (HDRI loading, cubemap baking), which is not built. The constant-ambient term this ADR introduces is the placeholder IBL replaces.
- **Light culling / per-camera light lists.** v1 uploads every visible light once; all cameras read the same `GpuLights`. Per-camera filtering lands with clustering or when a measured-perf consumer asks.
- **Deferred rendering / `OpaqueRendererMethod`.** Still absent (ADR-0028 §17). This ADR is forward-only.

## Decision

1. **Phase 10.1/10.3 lives in `packages/engine/src/light3d/`.** One concern per file (CLAUDE.md §5.5), re-exported through `index.ts`, and surfaced from the engine package root. Mirrors the established `light2d/` shape.

2. **Three light components + one ambient resource.** Bevy-shaped:

   - `PointLight3d` — `color: Vec3` (linear), `intensity: number` (unitless multiplier, no physical units), `range: number` (outer cutoff radius), `radius: number` (source radius for soft near-falloff). World position comes from `GlobalTransform`.
   - `SpotLight3d` — `PointLight3d`'s fields + `innerAngle` / `outerAngle` (cone half-angles, radians). The cone **direction is derived from the entity's `GlobalTransform` forward (−Z)** — there is deliberately no `direction` field (see decision 4).
   - `DirectionalLight3d` — `color`, `intensity`. Positionless; **direction is the entity's `GlobalTransform` forward (−Z)**.
   - All three require `[Transform, GlobalTransform, Visibility, InheritedVisibility, ViewVisibility]` so the visibility pipeline applies to lights as it does to meshes — an invisible light contributes nothing.
   - `AmbientLight` is a **resource, not a component** (roadmap 10.1: "ambient is a resource"). Shape `{ color: Vec3, brightness: number }` (Bevy parity). `Light3dPlugin` inserts a low default. This diverges from the 2D `AmbientLight2d` component deliberately — the roadmap calls for a resource, and a single scene-wide 3D ambient floor is the common case.

3. **Light direction derives from `GlobalTransform`, not an explicit field.** The forward vector (−Z basis column of the world matrix) aims `DirectionalLight3d` and `SpotLight3d`. This is the idiomatic 3D model: you aim a light by rotating/parenting its entity, it composes with the transform hierarchy, and there is one source of truth. It diverges from the 2D lights' explicit `direction: Vec2` field — acceptable because 3D scenes place lights via transforms and a quaternion-to-direction is the expected ergonomic. `prepare_lights` reads the −Z column at pack time.

4. **`GpuLights` is a single fixed-capacity uniform buffer at `@group(2) @binding(0)`.** Not a storage buffer — uniform arrays keep the path WebGL2-reachable and need no capability flag. Capacities (tunable): `MAX_DIRECTIONAL = 4`, `MAX_POINT = 64`, `MAX_SPOT = 64`. Each sub-struct is 16-byte-aligned so std140 array stride needs no extra padding:

   ```wgsl
   struct DirectionalLightGpu { direction: vec4<f32>, color: vec4<f32> };                 // 32B
   struct PointLightGpu       { position: vec4<f32>, color: vec4<f32>, params: vec4<f32> }; // 48B
   struct SpotLightGpu        { position: vec4<f32>, direction: vec4<f32>, color: vec4<f32>, params: vec4<f32> }; // 64B
   struct GpuLights {
     ambient: vec4<f32>,   // rgb + a = brightness
     counts: vec4<u32>,    // x = dir, y = point, z = spot
     directional: array<DirectionalLightGpu, 4>,
     point: array<PointLightGpu, 64>,
     spot: array<SpotLightGpu, 64>,
   };
   ```

   Field packing: directional `direction.xyz` = forward, `color.rgb` + `color.a` = intensity. Point `position.xyz` + `position.w` = range, `params.x` = radius, `params.y` = `1/range²` (precomputed CPU-side). Spot adds `direction.xyz` = cone forward, `direction.w` = `cos(innerAngle)`, `params.y` = `cos(outerAngle)`, `params.z` = `1/range²`. Total buffer = 7328 B, well under the 64 KiB uniform binding limit.

5. **`@group(2)` is the lights group.** ADR-0038 §2 set the live pipeline layout to `[view=@group(0), material=@group(1)]` (it renumbered ADR-0028 §10's original `@group(2)` material placement without superseding it). Lit-material pipeline layouts grow to `[view, material, lights]`. This **extends** ADR-0038's binding model additively — exactly as ADR-0042 grew ADR-0037's instance layout. **No sealed ADR is superseded.** (The `pbr.wgsl.ts` doc comment's stale "`@group(3)`" mention — predating ADR-0038's renumber — is corrected to `@group(2)` here; a code comment, not a sealed decision.)

6. **Lit vs unlit is gated by a static `usesLights` flag.** `MaterialCtor<M>` (the class-static surface `MaterialPlugin` reflects on) gains optional `readonly usesLights?: boolean`. `StandardMaterial` sets it `true`; `UnlitMaterial` leaves it absent. In `MaterialPlugin.specialize()`, when `usesLights` is true the lights bind-group layout (from the `GpuLights` resource) is appended to the pipeline layout. Unlit materials keep the 2-group layout untouched. This generalises to every future lit material and keeps unlit pipelines free of a lights binding.

7. **The Core3d phase nodes bind `@group(2)` centrally.** `OpaquePass3dNode` / `TransparentPass3dNode` already bind `@group(0)` (the view) immediately after `beginRenderPass` (ADR-0028 §11). They additionally call `pass.setBindGroup(2, lightsBindGroup)` when the `GpuLights` resource exists and is initialised. Binding a group the active pipeline's layout doesn't declare is permitted by WebGPU (ignored for that draw), so unlit pipelines drawn in the same pass are unaffected. Lights are camera-independent in v1, so one bind group serves every camera.

8. **`light3d-prepare` runs in `RenderSet.Prepare`.** A single system (mirrors `prepareLight2dTargets`'s lifecycle): it extracts the three light component queries (`Extract(Query([...]))`) + the `AmbientLight` resource, packs them into the `GpuLights` scratch via `pack*` helpers (skipping invisible lights, clamping to the per-kind capacities), writes the buffer once with `renderer.writeBuffer`, and lazily builds the `@group(2)` layout + bind group on first run (returns early until `ViewBindGroupCache.layout` exists — same first-frame-race pattern as `SpritePipeline`/`Light2dPipeline`). No Queue system is needed: simple forward has no per-camera light batches to emit.

9. **The BRDF loop replaces the hardcoded light in `pbr.wgsl`.** A new `retro_engine::light3d` WGSL module declares `GpuLights` + the `@group(2)` binding + a `compute_lighting(...)` helper (the existing GGX/Smith/Schlick terms, factored to take `N`, `V`, `L`, `radiance`, `roughness`, `f0`, `base_color`, `metallic`). `pbr.wgsl` `#import`s it and `fs_main` loops `counts.x` directional, then `counts.y` point, then `counts.z` spot lights — bounded by the compile-time `MAX_*` for uniform control flow — accumulating `direct`. Point/spot add inverse-square attenuation clamped by range; spot adds the angular `smoothstep(cosOuter, cosInner, dot(coneDir, toFrag))` cone term. Ambient becomes `gpu_lights.ambient.rgb * gpu_lights.ambient.a * base_color.rgb * occlusion`. All texture sampling and the `N`/`V`/`f0` setup are unchanged.

Composition-only. No abstract light base class; lights are plain components + a resource, and `Light3dPlugin` is a `PluginObject` registering systems + resources + WGSL. The HAL is consumed only through `renderer-core` types.

## Consequences

**Easier:**

- 3D meshes are lit by real, scene-placed lights end-to-end (`apps/playground` `?mode=lit`). Spawning `PointLight3d` / `SpotLight3d` / `DirectionalLight3d` and setting `AmbientLight` Just Works; no per-material glue.
- Shadow maps (10.4) layer on cleanly: the `GpuLights` struct grows per-light shadow metadata and `compute_lighting` gains a shadow factor, mirroring how ADR-0042 added `shadowRow` to ADR-0037.
- The unlit path is untouched — `usesLights` gates the third bind group, and the central `@group(2)` bind is a no-op for unlit pipelines.
- Direction-from-transform means a future spotlight cone gizmo, shadow frustum, and parenting all read one source of truth.

**Harder / accepted trade-offs:**

- **`O(fragments × lights)` shading.** Every fragment evaluates every light in `GpuLights`. This is the inherent cost of simple forward and degrades as light count and resolution grow. Clustered forward+ (backlog) is the fix; it is a pure optimisation over this foundation, not a rework.
- **Fixed light capacities.** Lights beyond `MAX_*` per kind are dropped (visible-order). 4/64/64 covers the foundation; raising them is a one-line constant + buffer-size change. A storage-buffer path (unbounded) is part of the clustering backlog item.
- **Uniform-buffer light data is re-uploaded every frame** even when lights are static. Change-gated upload is a deferred optimisation (same shape as the 2D per-frame rebuild).
- **The BRDF fragment loop is not headless-benchable** (GPU only) — verified in-browser. The CPU `pack*` path gets the bench.
- **`AmbientLight` as a resource diverges from `AmbientLight2d` (a component).** Intentional, per roadmap; regional 3D ambient (if ever needed) would be a separate component, not a reinterpretation of this resource.

## Not yet done

- **Clustered forward+** — `docs/backlog/3d-clustered-forward-plus.md` (CPU-binned vs compute-binned fork; `storageBuffers` capability flag; simple forward as the GL2 fallback).
- **Shadow maps / cascades / PCF** — Phase 10.4/10.5/10.6, the next ADRs.
- **IBL / environment maps** — Phase 10.7, gated on the asset system.
- **Per-camera light culling / render-layer light filtering.**
- **Change-gated `GpuLights` upload** and an unbounded storage-buffer light path.
- **Point-light radius as a real soft-shadow / area term** — packed but currently only softens near-field falloff.

## Implementation

- `packages/engine/src/light3d/index.ts` — re-exports the public surface.
- `packages/engine/src/light3d/point-light-3d.ts` — `PointLight3d`, `PointLight3dOptions`.
- `packages/engine/src/light3d/spot-light-3d.ts` — `SpotLight3d`, `SpotLight3dOptions`.
- `packages/engine/src/light3d/directional-light-3d.ts` — `DirectionalLight3d`, `DirectionalLight3dOptions`.
- `packages/engine/src/light3d/ambient-light.ts` — `AmbientLight` resource, `AmbientLightOptions`.
- `packages/engine/src/light3d/gpu-lights.ts` — `GpuLights` render-world resource (uniform buffer + `@group(2)` layout/bind group + lazy init), `GPU_LIGHTS_BYTE_SIZE`, `GPU_LIGHTS_FLOAT_COUNT`, `MAX_DIRECTIONAL_LIGHTS` / `MAX_POINT_LIGHTS` / `MAX_SPOT_LIGHTS`, `packDirectionalLight` / `packPointLight` / `packSpotLight` / `packAmbient`, `forwardFromMatrix`.
- `packages/engine/src/light3d/light-3d.wgsl.ts` — `LIGHT3D_WGSL` (`GpuLights` struct + `@group(2)` binding + `compute_lighting` helper), registered as `retro_engine::light3d`.
- `packages/engine/src/light3d/light-3d-plugin.ts` — `Light3dPlugin`, `prepareLights3d`.
- `packages/engine/src/light3d/*.test.ts` — component defaults, `gpu-lights` pack offsets / std140 / counts / capacity clamp, plugin (resources inserted, lit pipeline = 3 bind groups, unlit unaffected, WGSL registered).
- `packages/engine/src/material/pbr.wgsl.ts` (modified) — `#import retro_engine::light3d`; loop over `gpu_lights`; ambient from `gpu_lights.ambient`; doc comment `@group(3)` → `@group(2)`.
- `packages/engine/src/material/standard-material.ts` (modified) — `static readonly usesLights = true`; doc fix.
- `packages/engine/src/material/material-plugin.ts` (modified) — `MaterialCtor.usesLights?`; `specialize()` appends the lights layout when set.
- `packages/engine/src/render-graph/opaque-pass-3d-node.ts` / `transparent-pass-3d-node.ts` (modified) — conditional `setBindGroup(2, lightsBindGroup)`.
- `packages/engine/src/index.ts` (modified) — re-exports the `light3d` surface.
- `packages/engine/bench/light-3d.bench.ts` + `packages/engine/bench/index.ts` (modified) — `pack*` throughput at 64 / 256 / 1000 lights.
- `apps/playground/src/lit-showcase-plugin.ts` + `apps/playground/src/main.ts` (modified) — `?mode=lit` showcase.
