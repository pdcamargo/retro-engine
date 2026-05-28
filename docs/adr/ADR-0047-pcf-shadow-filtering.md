# ADR-0047: Phase 10.6 — PCF / shadow filtering kernels (`ShadowFilteringMethod`)

- **Status:** Accepted
- **Date:** 2026-05-28

## Context

[ADR-0045](ADR-0045-3d-shadow-maps.md) shipped directional + spot shadow maps over a shared `depth32float` 2D-array atlas with a comparison sampler (`compare: 'less-equal'`, linear min/mag), so the existing `textureSampleCompare` call already runs the hardware 2×2 bilinear PCF that GPUs perform for free under a linear-filtered comparison sampler. [ADR-0046](ADR-0046-cascaded-shadow-maps.md) extended that with cascades and per-fragment cascade selection, but did not touch the kernel — shadow edges are still hard, and the further cascades (where one texel covers a larger world area) read as visibly stairstepped. ADR-0045's "Not yet done" list called out PCF as the next-next ADR; ADR-0046 reiterated it. This ADR seals roadmap §10.6.

The roadmap line for §10.6 names the public symbol explicitly: `ShadowFilteringMethod`. The shape mirrors Bevy's enum of the same name, though the kernel set and the storage location are sized to this engine, not lifted whole.

This ADR **extends ADR-0045 additively — no supersession.** Same pattern ADR-0046 followed: `GpuLights` grows by 16 bytes (one trailing `vec4<u32>`), `retro_engine::shadow3d` gains two new kernel functions and a one-line dispatch, and the `@group(2)` binding model is unchanged. No new HAL, no new capability flag, no pipeline-specialization key.

Out of scope for this ADR (each with its trigger):

- **Per-camera `ShadowFilteringMethod`** (Bevy puts the enum on the camera). Our `Camera3d` doesn't have the bag of shadow knobs Bevy's does, and ADR-0046's atlas is already fit to the first active `Core3d` camera — per-camera filtering layered on a single-camera atlas would only be meaningful for filtering, not for fit. Deferred as a future component that overrides `Shadow3dSettings.filteringMethod`, same precedent as `CascadeShadowConfig` overriding `Shadow3dSettings.directionalExtent`. Tracked under "Not yet done".
- **Per-light / per-cascade kernel choice or radius scaling.** Farther cascades cover more world per texel, so an ideally-tuned per-cascade kernel radius would scale with cascade index. Deferred — the same depth-bias-per-cascade discussion ADR-0046 left open is the prerequisite (both want a per-cascade params slot).
- **PCSS (variable penumbra from blocker depth).** Different algorithm class — a blocker-search pass plus a separable filter. Independently useful but warrants its own ADR. Tracked under "Not yet done".
- **Receiver-plane / normal-biased depth bias.** Adjacent to PCF (both reduce visible acne), but a different lever — separate from kernel choice.
- **Temporal PCF** (jittered offsets + TAA accumulation). Gated on a future TAA / temporal-resolve ADR; the engine has no temporal infrastructure yet.

## Decision

1. **`ShadowFilteringMethod` is a frozen const-map + string-literal union** (not an enum, not a runtime class). Three values:
   - `'Hardware2x2'` — the existing single `textureSampleCompare` path. With the engine's linear-filtered comparison sampler this is hardware 2×2 bilinear PCF. **Default**; zero added GPU cost over ADR-0045/0046.
   - `'Castano13'` — Castaño 2013's 9-tap weighted-bilinear PCF (the kernel Bevy ships as its Gaussian option). 3×3 binomial weights (1-2-1 / 2-4-2 / 1-2-1, sum 16) over the atlas's texel spacing. ~9× sample cost; smooth penumbras.
   - `'Pcf5x5'` — 25-tap uniform-weight 5×5 PCF. Widest blur of the three; ~25× sample cost. For stylized soft-shadow looks.

2. **The active method is global, on `Shadow3dSettings.filteringMethod`.** Same pattern as `directionalExtent`, `depthBias`, `slopeScaleBias` — single render-world resource, default inserted by `Light3dPlugin`. Default `'Hardware2x2'`, so ADR-0045/0046 behaviour is byte-for-byte preserved.

3. **`GpuLights` grows by 16 bytes, additively.** A trailing `shadow_flags: vec4<u32>` is appended after `shadow_view_proj`; `shadow_flags.x` is the filtering-method ordinal (0 = `Hardware2x2`, 1 = `Castano13`, 2 = `Pcf5x5`), `.y/.z/.w` are reserved (zero) for future shadow knobs. Buffer 8112 → 8128 B. The `@group(2)` layout (lights uniform + atlas + comparison sampler) is unchanged — three bindings.

4. **Dispatch is dynamic via the uniform, in uniform control flow.** `retro_engine::shadow3d` adds a `sample_cascade_dispatch(layer, world_pos)` that branches on `lights.shadow_flags.x` and calls one of `sample_cascade` / `sample_cascade_castano13` / `sample_cascade_pcf5x5`. The branch is on a uniform value (same across the whole frame), so `textureSampleCompare`'s uniform-control-flow requirement is preserved. Both single-map (`shadow_factor`) and cascaded (`directional_shadow_factor`) call sites go through the dispatch — including the cascade-blend's "this cascade" + "next cascade" pair — so kernels stay symmetric across the seam. No pipeline specialization; toggling the method costs one uniform write per frame.

5. **All three kernels share `project_shadow(layer, world_pos)`** — a small helper that does the expensive `lights.shadow_view_proj[layer] * world_pos` multiply, the UV remap, the depth-reference + compile-time bias, and the "inside this layer's light frustum" mask. The kernel functions consume the result and only vary in their tap pattern. The same `project_shadow` powers `sample_cascade`, keeping the Hardware2x2 path identical to what shipped before.

6. **Tap spacing comes from `textureDimensions(shadow_atlas).x`,** read once per kernel call. Avoids a second source-of-truth for `SHADOW_MAP_SIZE` in WGSL (which currently only lives in TypeScript), and adapts automatically if the atlas resolution ever changes.

7. **`SHADOW_FILTERING_METHOD_ORDINAL` is the single ordinal table.** TypeScript writes `Hardware2x2 = 0u`, `Castano13 = 1u`, `Pcf5x5 = 2u`; WGSL branches on the same numbers via interpolated string constants in `SHADOW3D_WGSL`. A unit test (`shadow-filtering-method.test.ts`) asserts both sides agree.

Composition-only. `ShadowFilteringMethod` is a string-literal union; `Shadow3dSettings.filteringMethod` is a plain field on the existing render-world resource; the WGSL dispatch is a one-line branch. No new components, no new systems, no new render-graph nodes.

## Consequences

**Easier:**

- Soft shadows are a one-line opt-in (`Shadow3dSettings.filteringMethod = 'Castano13'`). The default `'Hardware2x2'` keeps everything ADR-0045/0046 shipped, bit-for-bit.
- Three tiers — single-tap, 9-tap weighted, 25-tap uniform — span the realistic quality/cost dial. A stylized scene that wants a wider blur has `'Pcf5x5'`; a perf-critical scene that wants the cheapest path stays on `'Hardware2x2'`.
- No binding-model or HAL change — `@group(2)` is still three entries (lights uniform + depth atlas + comparison sampler). Lit-material pipeline layouts pick up the grown uniform transparently.
- The path stays WebGL2-reachable: depth atlas + comparison sampler + per-fragment dispatch on a uniform value. No compute, no storage textures, no capability flag.
- Spot lights, point lights, the unlit path, and ADR-0046's cascade selection are untouched. The same kernel applies uniformly to every cascade.

**Harder / accepted trade-offs:**

- **VRAM is unchanged; uniform buffer grows by 16 bytes** (8112 → 8128). Trivial against the ~48 MB atlas.
- **`Castano13` is ~9× the sample cost of `Hardware2x2`; `Pcf5x5` is ~25×.** Per-frame cost scales with screen coverage of shadowed surfaces × shadowed light count × cascade count. Acceptable for the opt-in tiers; the default remains free.
- **The kernel choice is global per frame.** A spot light cannot use a different kernel than a directional; a per-camera split-screen cannot mix kernels. Per-camera / per-light override is a documented follow-on.
- **A single kernel radius applies to every cascade.** A farther cascade covers more world per texel, so the same UV-space tap pattern translates to a wider world-space penumbra — usually desirable, but per-cascade radius scaling would be ideal. Deferred (same prerequisite as per-cascade depth bias).
- **Visual correctness is browser-verified, not headless** (consistent with ADR-0045/0046). The bun suite covers the CPU surface (default value, `packShadowFlags` ordinals, grown `GPU_LIGHTS_BYTE_SIZE`, the WGSL/TS ordinal-table sync, and the `light3d-prepare` integration that packs the active method); the kernels themselves are validated visually in `apps/playground` (`?mode=lit&pcf=…`).
- **Pcf5x5's 25-tap loop is a constant-bounded `for` in WGSL.** Uniform control flow is preserved (the trip count is a compile-time constant), but shader-compile time grows modestly under aggressive unrolling. Not a runtime concern.

## Not yet done

- **Per-camera `ShadowFilteringMethod` override** (component on `Camera`).
- **Per-light / per-cascade kernel choice or radius scaling** (linked to the ADR-0046 per-cascade-bias follow-on).
- **PCSS** (variable penumbra from blocker depth) — separate ADR if pursued.
- **Receiver-plane / normal-biased depth bias.**
- **Temporal PCF** (jittered taps + TAA accumulation) — gated on a future TAA ADR.
- Inherited from ADR-0045/0046: point-light (cube) shadows, `NotShadowReceiver`, change-gated shadow rebuild, multi-camera cascade fitting.

## Implementation

- `packages/engine/src/light3d/shadow-filtering-method.ts` — `ShadowFilteringMethod` (frozen const map + string-literal union), `SHADOW_FILTERING_METHOD_ORDINAL` (Hardware2x2=0, Castano13=1, Pcf5x5=2).
- `packages/engine/src/light3d/shadow-3d-settings.ts` (modified) — `filteringMethod` field + option (default `Hardware2x2`).
- `packages/engine/src/light3d/gpu-lights.ts` (modified) — buffer 8112 → 8128 B; `SHADOW_FLAGS_BASE_U32 = 2028`; `packShadowFlags` packer; std140 layout comment updated.
- `packages/engine/src/light3d/light-3d.wgsl.ts` (modified) — appended `shadow_flags: vec4<u32>` to the `GpuLights` WGSL struct.
- `packages/engine/src/light3d/shadow-3d.wgsl.ts` (modified) — `project_shadow` helper, `shadow_texel_size`, `sample_cascade_castano13`, `sample_cascade_pcf5x5`, `sample_cascade_dispatch`; `shadow_factor` and `directional_shadow_factor` now go through the dispatch; `SHADOW3D_FILTER_HARDWARE2X2 / _CASTANO13 / _PCF5X5` ordinal constants mirror the TS table.
- `packages/engine/src/light3d/light-3d-plugin.ts` (modified) — `light3d-prepare` calls `packShadowFlags(u32, settings.filteringMethod)` alongside `packCounts` / `packCascadeSplits`.
- `packages/engine/src/light3d/index.ts`, `packages/engine/src/index.ts` (modified) — re-export `ShadowFilteringMethod` + `packShadowFlags`.
- `packages/engine/src/light3d/gpu-lights.test.ts` (modified) — layout asserts 8128 B / 2032 floats with `SHADOW_FLAGS_BASE = 2028`; `packShadowFlags` ordinal coverage.
- `packages/engine/src/light3d/shadow-3d.test.ts` (modified) — default `filteringMethod === 'Hardware2x2'`; `light3d-prepare` packs the active method into `u32[2028]`.
- `packages/engine/src/light3d/shadow-filtering-method.test.ts` (new) — `ShadowFilteringMethod` shape + frozen invariant; WGSL ↔ TS ordinal sync.
- `packages/engine/bench/shadow-3d.bench.ts` (modified) — `packShadowFlags` rotation micro-bench.
- `apps/playground/src/lit-showcase-plugin.ts` (modified) — `?pcf=castano13` / `?pcf=pcf5x5` URL switch that sets `Shadow3dSettings.filteringMethod` at startup; default unchanged.
