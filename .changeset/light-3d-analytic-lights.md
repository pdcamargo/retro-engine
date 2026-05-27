---
'@retro-engine/engine': minor
---

feat(engine): Phase 10.1/10.3 — 3D analytic lights + `GpuLights` uniform + simple-forward shading

Phase 10.1 ships the first 3D-lighting slice on top of the Phase 7 material/Core3d path. Per ADR-0044. `StandardMaterial`'s `pbr.wgsl` previously evaluated Cook-Torrance against a single hardcoded directional light + constant ambient; it now reads scene-placed analytic lights from a `GpuLights` uniform and loops over every light (simple forward), with ambient from the uniform.

A new `Light3dPlugin` registers the lights infrastructure; `StandardMaterial` now **requires** it (its shader imports `retro_engine::light3d` and binds the lights group at `@group(2)`). Unlit materials are unaffected.

Clustered forward+ (roadmap 10.2/10.3 cluster half) is backlogged; IBL (10.7) remains gated on the asset system.

**New public surface:**

- `PointLight3d` — `{ color: Vec3, intensity, range, radius }`. Auto-attaches `Transform + GlobalTransform + Visibility + InheritedVisibility + ViewVisibility`.
- `SpotLight3d` — point fields + `{ innerAngle, outerAngle }`. Cone direction derives from `GlobalTransform` forward (−Z) — no explicit direction field.
- `DirectionalLight3d` — `{ color, intensity }`; direction from `GlobalTransform` forward (−Z); position ignored.
- `AmbientLight` — **resource** (not a component) `{ color: Vec3, brightness: number }`. `Light3dPlugin` inserts a dim default.
- `PointLight3dOptions`, `SpotLight3dOptions`, `DirectionalLight3dOptions`, `AmbientLightOptions` — constructor input shapes.
- `Light3dPlugin` — registers the `retro_engine::light3d` WGSL, inserts `GpuLights` + `AmbientLight`, and runs the `light3d-prepare` (Prepare) system that packs every visible light into the uniform each frame.
- `GpuLights` — render-world resource owning the fixed-capacity uniform buffer (`@group(2) @binding(0)`) and its bind group.
- `GPU_LIGHTS_BYTE_SIZE` (7328), `GPU_LIGHTS_FLOAT_COUNT` (1832), `MAX_DIRECTIONAL_LIGHTS` (4), `MAX_POINT_LIGHTS` (64), `MAX_SPOT_LIGHTS` (64) — layout constants.
- `packDirectionalLight`, `packPointLight`, `packSpotLight`, `packAmbient`, `packCounts`, `forwardFromMatrix` — pure packers exposed for tests / benches / custom plugins.
- `LIGHT3D_WGSL` — WGSL source (`GpuLights` struct, `@group(2)` binding, per-light sample helpers).

**Behaviour changes:**

- `MaterialCtor` gains an optional static `usesLights` flag; when set (as on `StandardMaterial`), `MaterialPlugin` appends the lights bind-group layout so lit pipeline layouts are `[view, material, lights]`. Unlit materials keep `[view, material]`.
- `OpaquePass3dNode` / `TransparentPass3dNode` bind the lights group at `@group(2)` when a `GpuLights` resource is present (no-op for unlit pipelines and for scenes without `Light3dPlugin`).
- **Requires `Light3dPlugin`:** `StandardMaterial` no longer renders without it (the shader module + lights layout would be absent). Add it alongside `StandardMaterialPlugin` + `MaterialPlugin(StandardMaterial)`.
