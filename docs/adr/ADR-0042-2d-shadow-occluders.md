# ADR-0042: Phase 9.4 — 2D shadow occluders (per-light 1D shadow maps)

- **Status:** Accepted
- **Date:** 2026-05-27

## Context

[ADR-0037](ADR-0037-point-light-2d.md) built the 2D accumulation/composite
foundation; [ADR-0041](ADR-0041-2d-light-kinds-and-composite-modes.md) added the
remaining light kinds and composite modes. Roadmap §9.4 is the next stage:
line-of-sight shadows. This ADR seals the occluder model and the shadow
technique. It **extends** ADR-0037 — no sealed decision is replaced (the
accumulation pass still runs before the geometry passes, and lighting still
resolves in one instanced accumulation draw).

The technique is the standard 2D **1D shadow map**: per light, store the
nearest-occluder distance per angle in a small 1D map, then in the light pass
convert each fragment to polar `(angle, distance)` and compare. This gives an
`O(1)` shadow test per shaded fragment, independent of occluder count.

Two technique choices were weighed (an analytic ray-segment test in the
accumulation fragment vs. the 1D shadow map); the 1D shadow map was chosen for
its `O(1)` per-fragment cost. Because the engine's occluders are **explicit
segments** (not arbitrary sprite silhouettes), the 1D map is built
*analytically* — there is no occluder-map render + reduction intermediate (which
exists in sprite-based implementations only because those occluders aren't
analytic).

Out of scope (later stages / deferred):

- **Normal-map-aware lighting** (roadmap §9.5) — the next stage; reorders the
  pass chain.
- **Directional/ambient shadows** — directional and ambient lights are
  full-screen flat and remain unshadowed (a 1D polar map needs a light origin).
- **Per-camera occluder culling**, occluder counts beyond the budget, and
  dynamic atlas sizing — deferred until a measured-perf consumer asks.

## Decision

1. **`LightOccluder2d` is segment-based.** Fields: `segments: ReadonlyArray<[Vec2, Vec2]>`
   in the entity's local space, transformed to world space by its
   `GlobalTransform` each frame. A closed polygon is a loop of segments
   (`LightOccluder2d.fromPolygon`); `LightOccluder2d.rect(halfW, halfH)` is the
   common box. Same Required Components as the light kinds; an invisible occluder
   casts no shadow.

2. **One shared shadow atlas, built once per frame.** `Light2dShadowState` owns a
   single `LIGHT2D_SHADOW_ATLAS_WIDTH × LIGHT2D_MAX_SHADOW_CASTERS`
   (`256 × 64`) `rgba16float` texture — one row per shadow-casting point/spot
   light, each row a 1D map of normalized nearest-occluder distance per angle
   (stored in the red channel). The atlas is world-space and camera-independent,
   so the build node renders it on the first Core2d camera each frame and later
   cameras skip via a `builtThisFrame` guard.

3. **The 1D map is built analytically in one fullscreen draw.** The build inputs
   (occluder world segments, per-row light center+range, counts) live in one
   uniform buffer (`array<vec4>` of up to `LIGHT2D_MAX_OCCLUDER_SEGMENTS = 256`
   segments and `64` light rows). A single fullscreen triangle covers the atlas;
   the fragment maps each texel to `(angle = u·2π − π, lightRow = ⌊v·64⌋)`, loops
   the occluder segments computing ray-segment intersection distance, and writes
   the nearest hit normalized by the light's range (`1.0` = no occluder). No
   occluder-map intermediate, no min-blend.

4. **Shadows ride the existing single instanced accumulation draw** (ADR-0037
   decision 6, preserved). The atlas is bound once at the accumulation pipeline's
   `@group(1)`; each light instance carries a `shadowRow` (its atlas row, or
   `-1`). The accumulation fragment samples the atlas unconditionally (uniform
   control flow) and applies the shadow only to point/spot fragments with
   `shadowRow ≥ 0`: it converts the fragment to polar relative to the light
   (`u = (atan2(rel.y, rel.x) + π)/2π`, `r = |rel|/range`), and masks where
   `r` exceeds the stored distance, with a small bias band for a soft edge. A ray
   that hits no occluder (`stored ≈ 1`) never shadows.

5. **The instance layout grows 52 → 56 bytes** (`13 → 14` floats): a trailing
   `float32` `shadowRow` at `@location(6)`. Directional and ambient instances
   write `-1` (full-screen flat, never shadowed).

6. **Pass order: the shadow build is prepended.** New Core2d chain:
   `Light2dShadowPass2d → Light2dAccumulationPass2d → OpaquePass2d →
   TransparentPass2d → Light2dCompositePass2d`. ADR-0037 decision 5 is preserved
   — accumulation still precedes the geometry passes; the shadow node is added
   ahead of it.

7. **Fixed budgets, graceful overflow.** Up to `256` occluder segments and `64`
   shadow-casting lights per frame; extras are dropped (segments ignored, lights
   get `shadowRow = -1` and render unshadowed). Fixed sizes avoid per-frame
   atlas/buffer reallocation.

Composition-only. `LightOccluder2d` is a plain component; `Light2dShadowState`
is a render-world resource; the build is a graph node + the existing queue
system extended.

## Consequences

**Easier:**

- Point and spot lights cast real line-of-sight shadows from segment occluders,
  with moving occluders/lights handled per frame.
- The shadow test is `O(1)` per shaded fragment (one atlas sample), independent
  of occluder count — occluder cost is paid once into the small atlas.
- ADR-0037's single instanced accumulation draw is preserved — no per-light draw
  loop, no per-frame regression for scenes without occluders.
- No GPU capability is required: uniform buffers + a render-attachment float
  texture only (no compute, no storage textures), so the path is WebGL2-reachable.

**Harder / accepted trade-offs:**

- **Shadow shader correctness is browser-verified, not headless.** The bun test
  suite covers the CPU surface (occluder world-segment packing, row assignment,
  atlas allocation, pass presence/order, `shadowRow` in instances) via the
  capturing renderer; the polar build + sample math is validated visually in the
  playground (`?mode=lights`). This was an explicit, accepted choice when picking
  the 1D-shadow-map technique over an analytic in-shader test.
- **Fixed budgets.** 256 segments / 64 casters per frame. Overflow degrades
  gracefully (unshadowed) but silently; a measured-perf consumer can lift the
  caps later.
- **Segment occluders only.** No sprite-silhouette occluders — those would need
  the occluder-map + reduction path this ADR deliberately skipped.
- **Soft edge is a fixed bias band**, not a distance-scaled penumbra. Good enough
  for a retro look; a configurable penumbra is deferred.
- **The atlas is `rgba16float`** (3 unused channels) because the HAL format list
  has no single-channel float. The atlas is tiny (`256 × 64`), so the waste is
  negligible; adding `r16float` to the HAL is deferred until something else needs
  it.

## Not yet done

- **Normal-map-aware lighting.** Roadmap §9.5 — the next Phase 9 stage; reorders
  the pass chain so geometry produces per-pixel normals before accumulation.
- **Directional / ambient shadows.**
- **Sprite-silhouette occluders** (occluder-map path).
- **Configurable penumbra / soft-shadow quality.**
- **Budgets beyond 256 segments / 64 casters; per-camera occluder culling;
  dynamic atlas sizing.**
- **`r16float` HAL format** for a single-channel atlas.

## Implementation

- `packages/engine/src/light2d/light-occluder-2d.ts` — `LightOccluder2d`, `LightOccluder2dOptions`, `OccluderSegment`, `fromPolygon`, `rect`.
- `packages/engine/src/light2d/light-2d-shadow.ts` — `Light2dShadowState`, atlas + build pipeline, occluder/light packing (`pushOccluder`, `pushCaster`, `upload`, `beginFrame`), constants (`LIGHT2D_SHADOW_ATLAS_WIDTH`, `LIGHT2D_MAX_SHADOW_CASTERS`, `LIGHT2D_MAX_OCCLUDER_SEGMENTS`, `LIGHT2D_SHADOW_ATLAS_FORMAT`).
- `packages/engine/src/light2d/light-2d-shadow.wgsl.ts` — `LIGHT2D_SHADOW_WGSL` (analytic 1D-map build).
- `packages/engine/src/render-graph/light2d-shadow-pass-2d-node.ts` — `Light2dShadowPass2dNode`, `Light2dShadowPass2dLabel` (build-once-per-frame).
- `packages/engine/src/light2d/light-2d-pipeline.ts` — accumulation `@group(1)` shadow layout + `buildShadowAccumBindGroup`; instance `@location(6)` shadowRow.
- `packages/engine/src/light2d/light-2d-accumulation.wgsl.ts` — shadow sampling (uniform control flow) + masking for point/spot.
- `packages/engine/src/light2d/light-2d-batch.ts` — instance grown to 56 B / 14 f32; `shadowRow` packed by every `pack*` (point/spot from the caster row, directional/ambient `-1`).
- `packages/engine/src/render-graph/light2d-accumulation-pass-2d-node.ts` — binds the shadow `@group(1)`.
- `packages/engine/src/light2d/light-2d-plugin.ts` — inserts `Light2dShadowState`, registers `retro_engine::light2d_shadow`, adds the shadow node + edge, the `light2d-prepare-shadows` system, and extends `light2d-queue` to collect occluders + assign caster rows.
- `packages/engine/src/light2d/index.ts`, `packages/engine/src/render-graph/index.ts`, `packages/engine/src/index.ts` — re-exports.
- `packages/engine/src/light2d/light-occluder-2d.test.ts`, `packages/engine/src/light2d/light-2d-shadow.test.ts` — component + integration coverage.
- `packages/engine/bench/light-2d-shadow.bench.ts`, `packages/engine/bench/index.ts` — occluder pack throughput.
- `apps/playground/src/lights-showcase-plugin.ts` — two `LightOccluder2d` boxes in the `?mode=lights` scene.
