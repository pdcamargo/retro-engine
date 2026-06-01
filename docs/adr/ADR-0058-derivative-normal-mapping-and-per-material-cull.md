# ADR-0058: Derivative Normal Mapping and Per-Material Cull

- **Status:** Accepted
- **Date:** 2026-06-01

## Context

ADR-0057 §6 decided that `StandardMaterial` + `pbr.wgsl` gain `normalScale` (glTF
`normalTexture.scale`) and `doubleSided` (cull) so imported models render correctly out of the box.
It sealed *that* the material is extended; it did not seal *how* the surface normal is reconstructed
from a normal map. Two facts force that follow-on decision now:

- `pbr.wgsl` does not apply normal maps at all today. The normal texture is sampled into a discarded
  `_normal_sample` purely to satisfy pipeline validation; lighting runs on the geometric interpolated
  normal. There is no tangent-space normal, no TBN, no transform to world space for `normalScale` to
  multiply into. The path must be built before `normalScale` means anything.
- The vertex pipeline carries no tangent. `pbr.wgsl`'s vertex input is `POSITION + NORMAL + UV_0`
  plus the per-instance model matrices — no `TANGENT`. ADR-0057 §4 uses a *provided* glTF `TANGENT`
  attribute as-is but **defers tangent generation when it is absent**, and the glTF roadmap
  (`docs/roadmap/gltf.md`) lists the tangent-generation algorithm as an explicit open question that
  "should be an ADR when promoted." A non-glTF `StandardMaterial` — the common case — has no tangent
  source at all.

So the engine needs a normal-mapping path that does not require precomputed per-vertex tangents, and
the choice of that path is an architectural decision affecting normal-map correctness.

`doubleSided` additionally needs per-material cull to be expressible in the pipeline. The renderer
HAL already exposes `CullMode` in `PrimitiveState`, the WebGPU backend already maps it, and the
pipeline cache's structural digest already keys on it — but the material pipeline specialization
hardcodes `cullMode: 'back'`, so the flag has no route from a material instance to the pipeline.

## Decision

**Normal mapping uses a tangent-free screen-space-derivative cotangent frame (Schüler/Mikkelsen),
computed in the fragment shader.** `fs_main` reconstructs the tangent and bitangent from
`dpdx`/`dpdy` of world position and UV, decodes the sampled normal to `[-1, 1]`, multiplies its
tangent-space X/Y by `material.normal_scale`, and transforms it through that frame to world space.
Because `dpdx`/`dpdy` require uniform control flow, the perturbed normal is computed before the
alpha-cutoff `discard`. With no normal map bound, the flat-normal fallback decodes to `(0, 0, 1)` and
the result equals the geometric normal, so `normalScale` and the whole path are a no-op for plain
materials.

This is the engine's normal-mapping path **and the permanent no-tangent fallback.** A later slice may
add an interpolated per-vertex-tangent path (`#ifdef VERTEX_TANGENTS`) that takes precedence when a
`TANGENT` attribute flows through the mesh pipeline; that addition is **additive** and supersedes
neither this ADR nor ADR-0057 §4.

**`normalScale` is an additive `f32` in the material uniform.** It appends to the binding-0 packed
struct (payload 48 → 52 bytes, std140-rounded to a 64-byte slot). Per the repo's additive-binding
precedent (ADR-0044 lineage), growing the uniform supersedes nothing; ADR-0028 (material uniform) and
ADR-0057 stay sealed.

**`doubleSided` is a per-material pipeline-key dimension.** It is an optional `doubleSided(): boolean`
on the `Material` contract (default `false`, mirroring `alphaMode()`/`depthBias()`), threaded into
`MaterialPipelineKey`. The material specialization selects `cullMode: doubleSided ? 'none' : 'back'`
for both the opaque and prepass pipelines. Correct double-sided shading also requires flipping the
normal on back faces, so `fs_main` flips the reconstructed normal when `@builtin(front_facing)` is
false — harmless for single-sided materials, whose back faces are culled before the fragment stage.

**Scope boundary.** Normal-map application and the back-face flip land in `fs_main` (the visible
shading pass) only. The prepass normal output stays geometric and un-flipped this slice; it feeds
screen-space AO / temporal effects, not final shading, and gains the same treatment when a consumer
needs it.

## Consequences

**Easier.** `StandardMaterial` expresses normal-map strength and single-/double-sided rendering;
glTF material mapping has real fields to populate. Normal mapping works for any mesh with a UV and a
normal — no tangent authoring, generation, or extra vertex attribute required. Double-sided foliage,
cards, and glass render and shade from both faces. Single- and double-sided materials get distinct
cached pipelines automatically (the cache already keys on `cullMode`); no renderer-core or
renderer-webgpu change is needed.

**Harder / accepted trade-offs.**

- The derivative cotangent frame is an approximation: it costs per-fragment ALU (cross products and
  derivatives) on the main PBR path, and it is slightly less stable than an interpolated per-vertex
  tangent basis on low-tessellation or UV-distorted geometry. Accepted because it is self-contained,
  needs no mesh/vertex changes, and remains the correct no-tangent fallback once a vertex-tangent
  path lands.
- The normal-mapping math sits before the alpha-cutoff `discard` to keep derivatives in uniform
  control flow — a structural constraint on `fs_main` that future edits must preserve.
- The prepass normal buffer and the shaded normal can diverge for normal-mapped and back-facing
  surfaces until the prepass path is given the same treatment.

## Implementation

- `packages/engine/src/material/standard-material.ts` — `StandardMaterial.normalScale` (default `1`)
  and `StandardMaterial.doubleSided()` (default `false`); `normalScale` appended to the binding-0
  uniform schema (`StandardMaterial.bindGroup`).
- `packages/engine/src/material/pbr.wgsl.ts` — `normal_scale` in `StandardMaterialUniform`;
  `perturb_normal` helper; `fs_main` applies it before the discard and flips the normal on
  `!front_facing`.
- `packages/engine/src/material/material.ts` — optional `Material.doubleSided()`; `doubleSided` field
  on `MaterialPipelineKey`.
- `packages/engine/src/material/material-plugin.ts` — `doubleSided` read from the material instance
  and threaded into the pipeline key at the opaque, prepass, and retained queue sites and the
  specialization cache-key string; `cullMode` selected from it in the opaque and prepass
  specialization.
- Builds on ADR-0057 (glTF import) and ADR-0028 (material uniform); additive to both.
- (Reverse linkage only, per CLAUDE.md §4: the shipped sources above must not name this ADR.)

## Research citations

- WGSL derivative uniformity (`dpdx`/`dpdy`/`fwidth` require uniform control flow):
  <https://www.w3.org/TR/WGSL/#uniformity>
- Normal mapping without precomputed tangents (cotangent frame from screen-space derivatives):
  <http://www.thetenthplanet.de/archives/1180>
- glTF 2.0 `normalTexture.scale` semantics (scales sampled X/Y of the tangent-space normal):
  <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials-normaltextureinfo>
- glTF 2.0 `doubleSided` (disable back-face culling; flip normal for back-face lighting):
  <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials>
