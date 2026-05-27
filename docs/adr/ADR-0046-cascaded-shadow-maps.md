# ADR-0046: Phase 10.5 — Cascaded shadow maps for directional lights

- **Status:** Accepted
- **Date:** 2026-05-27

## Context

[ADR-0045](ADR-0045-3d-shadow-maps.md) shipped directional + spot shadow maps over a shared `depth32float` 2D-array atlas. Its directional projection is a **fixed orthographic box centered on the world origin** (`Shadow3dSettings.directionalExtent`): it does not follow the camera or fit the scene, so casters far from the origin fall outside it and go unshadowed, and the single 1024² map is stretched over a large box (blocky shadows). ADR-0045 named this explicitly as a limitation and listed cascaded shadow maps (roadmap §10.5) under "Not yet done", noting they would slot in as "additional array layers + per-fragment cascade selection".

This ADR seals §10.5. It **extends ADR-0045 additively — no supersession** — the same way ADR-0045 grew ADR-0044: `GpuLights` and the atlas grow, the directional shading path gains cascade selection, and the fixed box is retained as a fallback. No sealed decision is replaced; this fulfills ADR-0045's anticipated follow-on. No new HAL, no GPU capability flag.

Cascaded shadow maps split the camera's view frustum into N depth slices ("cascades"), fit each slice with its own tight light-space orthographic projection, and render each into its own atlas layer. The fragment shader selects a cascade per fragment by view-space depth. Near geometry gets a small, high-resolution cascade; far geometry gets a larger one — crisp shadows across the whole view as the camera moves.

Two decisions were resolved with the project owner before implementation:

- **Shared atlas, bumped budget** (vs. a separate cascade atlas, or carving the existing budget). The single 2D-array atlas and single `@group(2)` bind group are kept; a cascaded directional consumes `cascadeCount` *consecutive* layers via the existing greedy assignment. `MAX_SHADOW_CASTERS` grows 8 → 12 so the sun's cascades do not starve spot shadows. This is the literal realization of ADR-0045's "cascades are more layers" and adds no binding-model change.
- **Per-light `CascadeShadowConfig` component** (vs. a global resource), auto-inserted via `DirectionalLight3d.requires` (mirroring `Camera.requires = [Frustum]`). Cascades become the directional default; the fixed box is the fallback.

## Decision

1. **`CascadeShadowConfig` is a per-light component (Bevy-shaped), auto-inserted on every `DirectionalLight3d`.** Fields: `numCascades` (clamped `[1, MAX_CASCADES = 4]`), `minimumDistance` / `maximumDistance` (the view-space near/far of the cascaded range — the shadow draw distance, not the camera far plane), optional `firstCascadeFarBound`, `overlapProportion` (cascade blend band), and `lambda` (uniform↔logarithmic split blend). `MAX_CASCADES = 4` because the split distances are uploaded as a single `vec4<f32>`.

2. **Cascades replace the fixed directional box when a perspective camera drives the scene; the fixed box is the fallback.** `light3d-prepare` extracts the active `Core3d` perspective camera (`Extract(Query([Camera, PerspectiveProjection]))`, lowest `order`, `isActive`, `subGraph === Core3dLabel`) from the main world — `Camera.computed` is fresh from `postUpdate`, so no render-phase ordering dependency is needed. With no such camera (e.g. an orthographic-only scene), each directional falls back to ADR-0045's fixed origin box (`Shadow3dSettings.directionalExtent`).

3. **Split distances are computed once per frame from the camera, shared across all cascaded directionals.** The split distances are a function of the camera frustum (not the light), so sharing them is correct, not a compromise. They use the practical split scheme — a `lambda` blend of a uniform and a logarithmic distribution between `minimumDistance` and `maximumDistance` (`computeCascadeSplits`). Per-light independent split *ranges* are deferred.

4. **Each cascade is fit with a stabilized light-space orthographic projection** (`cascadeLightViewProj`, pure). The slice's 8 view-space frustum corners are transformed to world space and bounded by a **sphere** (centroid + max radius) so the projection's size is invariant to camera rotation — the dominant shimmer source. The projection is then **texel-snapped** (the world origin is shifted onto an exact shadow texel) so it is stable under camera translation. The depth range is extended toward the light by `Shadow3dSettings.cascadeBackExtension` to capture occluders just outside the slice.

5. **`GpuLights` grows additively.** A `cascade_splits: vec4<f32>` (the per-cascade far view-depths) is appended after `spot`, and `shadow_view_proj` grows from 8 to 12 matrices; the buffer is now 8112 B. `counts.w` (previously unused) holds the cascade count. A shadowed directional stores its **base** atlas layer in `direction.w` (cascade `c` occupies layer `base + c`). The `@group(2)` layout is unchanged (three bindings) — only the uniform's size grew.

6. **`pbr.wgsl` selects the cascade per fragment by view-space depth.** A new `directional_shadow_factor(base_index, world_pos, view_z)` in `retro_engine::shadow3d` picks the first cascade whose split distance exceeds `view_z` (computed from `view.view`, already bound at `@group(0)`), samples that layer, and cross-fades into the next cascade across a small band (`SHADOW3D_CASCADE_BLEND`). `textureSampleCompare` is called unconditionally with a per-fragment array layer (uniform control flow preserved, mirroring ADR-0045's `shadow_factor`, which spot lights still use unchanged). The shared sampling core is factored into `sample_cascade`.

7. **The shadow pass and caster queue are unchanged.** A directional simply occupies more layers; `Shadow3dPass3dNode` renders one depth pass per assigned layer over the same caster batches, and `MAX_SHADOW_CASTERS = 12` auto-sizes the atlas, per-layer views, and depth-pass uniforms.

Composition-only. `CascadeShadowConfig` is a plain component; the cascade math is pure functions; the only wiring change is `light3d-prepare` reading the camera and assigning a run of layers per directional.

## Consequences

**Easier:**

- Directional shadows fit the camera frustum and stay crisp from near to the shadow draw distance, as the camera moves — the ADR-0045 fixed-box limitation is gone. Browser-verified in `apps/playground` (`?mode=lit`: pillars receding into depth shadow correctly under a dollying camera).
- Stabilization (bounding sphere + texel snap) keeps shadows shimmer-free under camera motion; both properties are unit-tested (rotation-invariant box size, world origin snapped to an exact texel).
- No binding-model or HAL change; the path stays WebGL2-reachable (render-attachment depth + comparison sampler only).
- Spot lights, point lights, and the unlit path are untouched.

**Harder / accepted trade-offs:**

- **VRAM grows** ~32 MB → ~48 MB at defaults (12 × 1024² × 4 B); `MAX_SHADOW_CASTERS` and `SHADOW_MAP_SIZE` stay tunable.
- **The atlas is now camera-dependent.** Cascades fit the first active `Core3d` camera; the `builtThisFrame` guard means secondary cameras reuse that fit (slightly wrong for them). Multi-camera per-view cascade fitting is deferred.
- **Split distances are global per frame** (shared across cascaded directionals). Correct for the common single-sun case; per-light split ranges are deferred.
- **Every caster is drawn into every cascade layer** (up to 4× the directional depth draws vs. ADR-0045's one). Per-cascade caster culling is a future optimization.
- **A single depth bias serves all cascades.** Farther cascades cover more world per texel, so acne/peter-panning may differ across cascades; per-cascade bias scaling is a documented follow-on.
- **Correctness is browser-verified, not headless** (as in ADR-0045). The bun suite covers the CPU surface (split math, the stabilized fit's rotation-invariance + texel-snap, the grown `GpuLights` offsets, layer reservation + overflow, the cascade count packed into the lights uniform); the depth render + comparison sample are validated visually.

## Not yet done

- **Per-light independent cascade split ranges** (v1 shares one camera-derived split set).
- **Multi-camera cascade fitting** (the atlas is fit to the first active `Core3d` camera).
- **Per-cascade caster culling** (every caster draws into every cascade layer).
- **Per-cascade / runtime-configurable depth bias** (`overlapProportion` likewise is a compile-time blend constant in this stage; the config field is the runtime hook once uploaded).
- **Point-light (cube) shadows, `NotShadowReceiver`, PCF / configurable filtering, change-gated shadow rebuild** — all still open from ADR-0045.

## Implementation

- `packages/engine/src/light3d/cascade-shadow-config.ts` — `CascadeShadowConfig`, `CascadeShadowConfigOptions`, `MAX_CASCADES`.
- `packages/engine/src/light3d/cascade-shadow.ts` — `computeCascadeSplits`, `cascadeLightViewProj`, `CascadeFitParams`, `reserveCasterLayers` (pure split + stabilized-fit + layer-reservation helpers).
- `packages/engine/src/light3d/gpu-lights.ts` (modified) — `MAX_SHADOW_CASTERS` 8→12; `cascade_splits` vec4 + grown `shadow_view_proj` (buffer 8112 B); `packCounts` gains `cascadeCount` (→ `counts.w`); `packCascadeSplits`, `packDirectionalCascadeBase`.
- `packages/engine/src/light3d/light-3d.wgsl.ts` (modified) — `MAX_SHADOW_CASTERS = 12u`, `cascade_splits` field, `counts.w` = cascade count, `direction.w` = cascade base.
- `packages/engine/src/light3d/shadow-3d.wgsl.ts` (modified) — `sample_cascade`, `directional_shadow_factor` (cascade selection + blend), `SHADOW3D_CASCADE_BLEND`; `shadow_factor` retained for spot.
- `packages/engine/src/material/pbr.wgsl.ts` (modified) — `view_z` from `view.view`; directional loop calls `directional_shadow_factor`.
- `packages/engine/src/light3d/directional-light-3d.ts` (modified) — `CascadeShadowConfig` added to `requires`.
- `packages/engine/src/light3d/light-3d-plugin.ts` (modified) — extracts the active `Core3d` perspective camera; `light3d-prepare` computes the shared splits and assigns a run of cascade layers per directional (fixed-box fallback otherwise); packs `cascade_splits` + cascade count.
- `packages/engine/src/light3d/shadow-3d-settings.ts` (modified) — `cascadeBackExtension`; `directionalExtent` redocumented as the fallback.
- `packages/engine/src/light3d/index.ts`, `packages/engine/src/index.ts` (modified) — re-exports.
- `packages/engine/src/light3d/{cascade-shadow,gpu-lights,shadow-3d,light-3d-components,not-shadow-caster}.test.ts` (new/extended) — CPU coverage.
- `packages/engine/bench/shadow-3d.bench.ts` (modified) — cascade split + fit + pack throughput.
- `apps/playground/src/lit-showcase-plugin.ts` (modified) — large ground + receding pillars + dollying camera for `?mode=lit`.
