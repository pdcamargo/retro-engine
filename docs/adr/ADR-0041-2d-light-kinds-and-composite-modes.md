# ADR-0041: Phase 9.1/9.3 — `SpotLight2d` / `DirectionalLight2d` / `AmbientLight2d` + composite modes

- **Status:** Accepted
- **Date:** 2026-05-27

## Context

[ADR-0037](ADR-0037-point-light-2d.md) shipped the first slice of 2D lighting:
the accumulation-then-composite pass chain, a per-camera `baseColor` /
`lightAccum` intermediate, the `PointLight2d` component, and a multiply-only
composite. Its §"Not yet done" pre-authorised the rest of roadmap §9.1
(`SpotLight2d` / `DirectionalLight2d` / `AmbientLight2d` components) and §9.3
(the `'add'` / `'screen'` composite modes the `Light2dSettings.compositeMode`
field already reserved). This ADR seals that additive layer.

This is the first of three stages completing Phase 9. It deliberately does **not**
touch the load-bearing structure ADR-0037 established — the pass order, the
single instanced accumulation draw, and the geometry-before-or-after question
are untouched here and handled by the later shadow and normal-mapping ADRs.
Nothing in ADR-0037 is superseded.

Out of scope for this ADR (still tracked for the later Phase 9 stages):

- **2D shadow occluders** (roadmap §9.4) — a per-light occlusion technique and a
  per-light accumulation path.
- **Normal-map-aware lighting** (roadmap §9.5) — per-pixel normals, which force
  geometry to run before accumulation. Until that lands, `DirectionalLight2d`'s
  direction has no visible effect (see Decision 4).

## Decision

1. **One instanced accumulation draw spans every light kind, discriminated
   per-instance.** ADR-0037 decision 6 (a single non-specialised accumulation
   pipeline, one instanced draw over all visible lights) is **carried forward and
   extended**, not replaced. A trailing `kind` discriminator on each packed
   instance selects geometry in the vertex shader and falloff in the fragment
   shader. No new pipeline, no extra draw call — a scene of mixed point / spot /
   directional / ambient lights still resolves in one `drawIndexed` per camera.

2. **The instance layout grows to 52 bytes / 13 floats: three `float32x4` slots
   plus a trailing `float32` kind.** ADR-0037's 32-byte / 2-`vec4` layout could
   not hold a spot cone (`direction.xy` + `cosInner` + `cosOuter`) and a kind
   tag. The slots are reinterpreted per kind:
   - `@location(2)` — `center.xy` + footprint `(p0, p1)`: `(range, radius)` for
     point / spot, `(halfWidth, halfHeight)` for a regional ambient zone.
   - `@location(3)` — `color.rgb + intensity` (all kinds).
   - `@location(4)` — spot cone `direction.xy + cosInner + cosOuter`; carries the
     direction for `DirectionalLight2d` (dormant until §9.5); zero otherwise.
   - `@location(5)` — `kind` (`0` point, `1` spot, `2` directional, `3` ambient
     zone), read in WGSL via float compare.
   `LIGHT2D_INSTANCE_BYTE_SIZE` and `LIGHT2D_INSTANCE_FLOAT_COUNT` are the
   single source of truth for the stride; the pipeline `arrayStride`, the
   instance buffer growth, and the bench all reference them.

3. **`SpotLight2d` is `PointLight2d` plus a cone.** Fields: the point set
   (`color`, `intensity`, `range`, `radius`) plus `direction: Vec2`,
   `innerAngle`, `outerAngle` (half-angles in radians). The fragment multiplies
   the radial `1 - smoothstep(radius, range, distance)` by the angular term
   `smoothstep(cos(outerAngle), cos(innerAngle), dot(direction, toFragment))`.
   The footprint quad is the same `2 * range` square as a point light, so the
   cone clips inside the existing footprint. Same Required Components as
   `PointLight2d`.

4. **`DirectionalLight2d` is a positionless full-screen flat add.** Fields:
   `color`, `intensity`, `direction: Vec2`. It is emitted as a full-screen quad
   in clip space (bypassing the view matrix) at constant `color * intensity`.
   Its `direction` is carried through to the instance but has **no visible
   effect** without per-pixel normals — until normal-map-aware lighting (§9.5)
   lands, a `DirectionalLight2d` is a uniform directional ambient wash. This is
   documented on the component and accepted: shipping the final field shape now
   means §9.5 adds shading math, not a breaking component change.

5. **`AmbientLight2d` is a regional ambient zone.** Fields: `color`,
   `intensity`, `halfExtents?: Vec2`. With `halfExtents` it fills a world-space
   rectangle centred on the entity's `GlobalTransform` with a flat additive
   contribution; overlapping zones sum, on top of the global
   `Light2dSettings.ambient` floor. Without `halfExtents` it is global
   (full-screen) and is then functionally identical to raising
   `Light2dSettings.ambient` — the component's TSDoc steers single-floor use
   cases to the setting. The component exists for the multi-zone case one global
   setting cannot express, exactly as ADR-0037 anticipated.

6. **Composite modes are specialised per mode, not branched per pixel.** The
   composite WGSL exposes one fragment entry point per mode — `fs_multiply`,
   `fs_add` (`base + light`), `fs_screen` (`1 - (1 - base)(1 - light)`). The
   composite specialisation key gains `compositeMode`; the composite node reads
   `Light2dSettings.compositeMode` per frame and fetches the matching cached
   pipeline. Switching modes selects a pipeline rather than paying a per-pixel
   branch, matching the existing `SpecializedRenderPipelines` pattern (the key
   already varied on surface format).

7. **The queue packs all kinds into the shared buffer in one pass.** `light2d-queue`
   extracts four visible-light queries (`PointLight2d` / `SpotLight2d` /
   `DirectionalLight2d` / `AmbientLight2d`, each with `GlobalTransform` +
   `ViewVisibility`), packs them in kind order via the per-kind `pack*` functions
   into the shared `Light2dInstanceBuffer`, and emits one batch per Core2d
   camera — unchanged batching shape from ADR-0037.

Composition-only. New components are plain classes with a `requires` array; no
inheritance, no shared light base.

## Consequences

**Easier:**

- The full 2D light family is available: cones, directional washes, and regional
  ambient pools, alongside point lights — all through one plugin and one draw.
- Composite `add` / `screen` modes work, so additive glows and soft-light
  overlays are a one-line `Light2dSettings.compositeMode` change.
- Spot lights reuse the point footprint and falloff verbatim; the cone is a
  single extra `smoothstep`, so the shared accumulation path stays small.
- The instance layout now has a kind discriminator and a free cone slot, which
  the normal-mapping stage (§9.5) reuses for per-light direction without another
  layout bump.

**Harder / accepted trade-offs:**

- **Per-light memory grew 32 → 52 bytes (~62%).** A 5 000-light scene's instance
  buffer goes from ~160 KB to ~260 KB. Negligible against the per-camera target
  textures, and the pack loop is still linear; the bench tracks both point and
  spot pack throughput.
- **`DirectionalLight2d`'s direction is inert until §9.5.** Shipping the field
  now is a deliberate forward-compatibility call (documented on the component) —
  the alternative is a breaking component change when normal mapping lands.
- **Each directional / global-ambient light is a full-screen instanced quad.**
  Cheap (4 verts, flat fragment) but it does shade every pixel; many overlapping
  full-screen lights cost fill rate. Expected counts are low; spatial culling is
  still deferred to a measured-perf consumer (ADR-0037).
- **Boundless `AmbientLight2d` overlaps `Light2dSettings.ambient`.** Two ways to
  express the same global floor. Mitigated by TSDoc; not worth a runtime guard.

## Not yet done

- **2D shadow occluders.** Roadmap §9.4 — the next Phase 9 stage.
- **Normal-map-aware lighting.** Roadmap §9.5; reorders the pass chain so
  geometry produces normals before accumulation. `DirectionalLight2d` /
  `SpotLight2d` directionality becomes visible here.
- **HDR / tonemapping coupling.** Phase 12.
- **Light culling / spatial structures.** Still iterates every visible light.
- **Per-light `Z`-range filtering.**
- **`Material2d` shader response to lighting** (`LitMaterial2d`).
- **Cross-frame instance buffer persistence / incremental rebuild.**

## Implementation

- `packages/engine/src/light2d/spot-light-2d.ts` — `SpotLight2d`, `SpotLight2dOptions`.
- `packages/engine/src/light2d/directional-light-2d.ts` — `DirectionalLight2d`, `DirectionalLight2dOptions`.
- `packages/engine/src/light2d/ambient-light-2d.ts` — `AmbientLight2d`, `AmbientLight2dOptions`.
- `packages/engine/src/light2d/light-2d-batch.ts` — `Light2dKind`, grown `LIGHT2D_INSTANCE_BYTE_SIZE` (52) / `LIGHT2D_INSTANCE_FLOAT_COUNT` (13), `packLightInstance`, `packSpotLightInstance`, `packDirectionalLightInstance`, `packAmbientLightInstance`.
- `packages/engine/src/light2d/light-2d-accumulation.wgsl.ts` — per-kind geometry + falloff branching, third instance attribute + kind.
- `packages/engine/src/light2d/light-2d-composite.wgsl.ts` — `fs_multiply` / `fs_add` / `fs_screen` entry points.
- `packages/engine/src/light2d/light-2d-pipeline.ts` — accumulation `arrayStride` 52 + `@location(4)`/`@location(5)`; `Light2dCompositeKey.compositeMode` + per-mode entry-point selection.
- `packages/engine/src/render-graph/light2d-composite-pass-2d-node.ts` — feeds `Light2dSettings.compositeMode` into the composite pipeline key.
- `packages/engine/src/light2d/light-2d-plugin.ts` — `queueLight2dInstances` packs all four kinds.
- `packages/engine/src/light2d/light-2d-settings.ts` — composite-mode docs (all modes now implemented).
- `packages/engine/src/light2d/index.ts`, `packages/engine/src/index.ts` — re-exports.
- `packages/engine/src/light2d/{spot,directional,ambient}-light-2d.test.ts` — component coverage.
- `packages/engine/src/light2d/light-2d-plugin.test.ts` — per-kind packing + per-mode composite specialisation.
- `packages/engine/bench/light-2d.bench.ts` — point + spot pack throughput at 100 / 1 000 / 5 000.
- `apps/playground/src/lights-showcase-plugin.ts` — adds a `SpotLight2d` cone + an `AmbientLight2d` zone to the `?mode=lights` scene.
