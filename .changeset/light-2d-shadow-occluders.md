---
'@retro-engine/engine': minor
---

feat(engine): 2D shadow occluders via per-light 1D shadow maps — Phase 9.4

Adds line-of-sight 2D shadows for `PointLight2d` / `SpotLight2d`. Per ADR-0042 (extends ADR-0037). A new `LightOccluder2d` component defines segment occluders; a shared shadow atlas stores a 1D nearest-occluder-distance map per shadow-casting light, built analytically each frame, and the accumulation pass samples it to mask occluded fragments. The shadow test is `O(1)` per shaded fragment, and ADR-0037's single instanced accumulation draw is preserved — scenes without occluders pay nothing new. No GPU capability is required (uniform buffers + a float render target only).

**New public surface:**

- `LightOccluder2d` — `{ segments: ReadonlyArray<[Vec2, Vec2]> }` in local space, transformed to world space by the entity's `GlobalTransform`. Statics `LightOccluder2d.fromPolygon(points, closed?)` and `LightOccluder2d.rect(halfWidth, halfHeight)`. Auto-attaches the canonical visibility/transform chain; an invisible occluder casts no shadow.
- `LightOccluder2dOptions`, `OccluderSegment` — input shape + segment type.
- `Light2dShadowState` — render-world resource owning the shadow atlas (`256 × 64` `rgba16float`, one row per caster), the analytic build pipeline, and the per-frame occluder/light uniform.
- `Light2dShadowPass2dNode`, `Light2dShadowPass2dLabel` — Core2d node that builds the atlas once per frame, ordered before accumulation.
- `LIGHT2D_SHADOW_WGSL` — the build shader source.
- `LIGHT2D_SHADOW_ATLAS_WIDTH` (256), `LIGHT2D_MAX_SHADOW_CASTERS` (64), `LIGHT2D_MAX_OCCLUDER_SEGMENTS` (256), `LIGHT2D_SHADOW_ATLAS_FORMAT` (`'rgba16float'`) — budgets / format.

**Behaviour changes (non-breaking):**

- `LIGHT2D_INSTANCE_BYTE_SIZE` is now `56` (was `52`) and `LIGHT2D_INSTANCE_FLOAT_COUNT` is now `14` (was `13`) — a trailing `shadowRow` float. The `pack*` functions gain a `shadowRow` parameter (`packLightInstance` / `packSpotLightInstance`); directional / ambient instances pack `-1`. Code reading the layout constants is unaffected.
- The Core2d sub-graph gains the shadow node when `Light2dPlugin` is installed. Final chain: `Light2dShadowPass2d → Light2dAccumulationPass2d → OpaquePass2d → TransparentPass2d → Light2dCompositePass2d`.
- `Light2dPlugin` inserts a `Light2dShadowState` resource and registers a `light2d-prepare-shadows` system; `light2d-queue` now also collects occluders and assigns shadow rows.

**Limits (v1):** segment occluders only; up to 256 segments and 64 shadow-casting lights per frame (overflow renders unshadowed); directional/ambient lights are unshadowed; soft edge is a fixed bias band.
