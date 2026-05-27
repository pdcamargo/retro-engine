---
'@retro-engine/engine': minor
---

feat(engine): Phase 10.4 — 3D shadow maps (directional + spot)

Per ADR-0045, extends ADR-0044's analytic 3D lighting with shadow maps for directional and spot lights. A new depth prepass renders shadow-caster mesh depth from each light's point of view into a shared `depth32float` 2D-array atlas (one layer per caster); `StandardMaterial`'s `pbr.wgsl` now multiplies each directional / spot light's contribution by a `shadow_factor` sampled from that atlas with a comparison sampler. No new HAL, no GPU capability flag.

Existing lit scenes gain shadows automatically — `Light3dPlugin` wires the atlas, the prepass node, and the shading. The `@group(2)` lights bind group grows from one binding (lights uniform) to three (uniform + shadow atlas + comparison sampler); lit pipeline layouts pick this up transparently. Unlit materials and point lights are unaffected (point-light cube shadows are a documented follow-on).

**New public surface:**

- `NotShadowCaster` — marker component opting a mesh out of casting shadows (it still renders and receives). Every visible `Mesh3d` casts by default.
- `Shadow3dSettings` — render-world resource tuning shadows: `directionalExtent` (orthographic frustum half-size), `near`, `far`, `depthBias`, `slopeScaleBias`, `cullMode`. `Light3dPlugin` inserts a default. `Shadow3dSettingsOptions` is the constructor input shape.
- `Shadow3dState` — render-world resource owning the 2D-array depth atlas, the depth-only pipeline, per-layer light-space view-proj uniforms, and caster batches.
- `Shadow3dPass3dNode` / `Shadow3dPass3dLabel` — Core3d render-graph node, prepended before the opaque pass, that renders caster depth into each light's atlas layer.
- `SHADOW3D_WGSL` (`retro_engine::shadow3d`: shadow atlas + comparison sampler bindings + `shadow_factor`), `SHADOW3D_DEPTH_WGSL` (standalone depth-render shader).
- `directionalLightViewProj`, `spotLightViewProj`, `assignCasterLayer` — pure light-space-matrix helpers (exposed for tests / benches / custom plugins).
- `MAX_SHADOW_CASTERS` (8), `NO_SHADOW_CASTER` (-1), `SHADOW_MAP_SIZE` (1024), `SHADOW_ATLAS_FORMAT` (`depth32float`) — layout constants.
- `packShadowViewProj`, `packDirectionalCasterIndex`, `packSpotCasterIndex` — pure packers for the new `GpuLights` shadow metadata.

**Behaviour changes:**

- `GpuLights` grew: the uniform buffer is now 7840 B (was 7328) with a trailing `shadow_view_proj: array<mat4x4<f32>, 8>`; each shadowed directional / spot light stores its atlas-layer index in `direction.w` / `params.w` (`-1` = unshadowed). `GpuLights.ensureInitialised` now builds a 3-entry `@group(2)` layout and no longer builds the bind group itself — `Shadow3dState.ensure` builds it (via the new `GpuLights.buildShadowBindGroup`) once the atlas + comparison sampler exist.
- `Light3dPlugin` now requires a `RenderGraphPlugin` (it injects the shadow node into the Core3d sub-graph) and runs two new systems: `shadow3d-prepare` (Prepare) and `shadow3d-queue` (Queue).
- Up to 8 shadow-casting lights per frame (directional first, then spot, in visible order); extras render unshadowed. The directional frustum is a fixed orthographic box around the world origin (cascades add camera fitting in a later stage).
