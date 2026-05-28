---
'@retro-engine/engine': minor
---

feat(engine): Phase 10.6 — PCF / shadow filtering kernels (`ShadowFilteringMethod`)

Per ADR-0047, layers configurable shadow filtering on top of ADR-0045's (directional + spot) and ADR-0046's (cascaded directional) shadow maps. A new `Shadow3dSettings.filteringMethod` selects the kernel `retro_engine::shadow3d` uses to sample the shadow atlas; the default `Hardware2x2` keeps existing behaviour bit-for-bit, while `Castano13` (9-tap weighted-bilinear Gaussian) and `Pcf5x5` (25-tap uniform) give softer penumbras at higher GPU cost. No new HAL, no new capability flag, no binding-model change.

The choice is global per frame, applies to every shadowed light and every cascade, and is dispatched in WGSL from a new `GpuLights.shadow_flags` vec4 — uniform control flow is preserved, so `textureSampleCompare` stays legal in every branch. Spot lights, point lights, and the unlit path are unaffected.

**New public surface:**

- `ShadowFilteringMethod` — frozen const map + string-literal union: `'Hardware2x2' | 'Castano13' | 'Pcf5x5'`.
- `Shadow3dSettings.filteringMethod` (+ option) — render-world resource field selecting the active kernel. Default `Hardware2x2`.
- `packShadowFlags` — pure packer writing the filtering ordinal into the trailing `shadow_flags.x` slot of the lights uniform.

**Behaviour changes:**

- `GpuLights` grew by one trailing `shadow_flags: vec4<u32>`: the uniform buffer is now 8128 B (was 8112). `shadow_flags.x` carries the active `ShadowFilteringMethod` ordinal (0=Hardware2x2, 1=Castano13, 2=Pcf5x5); `.y/.z/.w` are reserved (zero). The `@group(2)` layout is unchanged — three bindings (lights uniform + shadow atlas + comparison sampler).
- `Light3dPlugin`'s `light3d-prepare` packs the active method via `packShadowFlags` alongside the existing `packCounts` / `packCascadeSplits` calls.
- `retro_engine::shadow3d` now dispatches `shadow_factor` / `directional_shadow_factor` through `sample_cascade_dispatch` and exposes `sample_cascade_castano13` / `sample_cascade_pcf5x5` kernel functions over the same `project_shadow` core. Tap spacing uses `textureDimensions(shadow_atlas).x` so the WGSL adapts to any future atlas-resolution change without re-syncing constants.
