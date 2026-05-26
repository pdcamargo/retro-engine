# ADR-0037: Phase 9.1 — `PointLight2d` + accumulation/composite passes

- **Status:** Accepted
- **Date:** 2026-05-26

## Context

The renderer roadmap §9 (`docs/roadmap/renderer.md`) ships 2D lighting as the next layer on top of the Phase 8.x sprite + Material2d Core2d sub-graph. Bevy does not ship 2D lighting in core; the community implements it as "accumulate per-camera light contribution into an off-screen texture, then composite that texture over the base 2D color." This ADR seals Phase 9.1 — the first end-to-end slice of that pattern. `PointLight2d` is the only light component; `SpotLight2d`, `AmbientLight2d` (as a component), `DirectionalLight2d`, 2D shadow occluders (§9.4), normal-map-aware lighting (§9.5), and HDR coupling (Phase 12) are deliberately scoped out and tracked in §"Not yet done" below.

The load-bearing architectural pivot for this phase is the per-camera draw chain. Pre-9.1 the Core2d sub-graph was `OpaquePass2dNode → TransparentPass2dNode`, and both nodes wrote their color attachment directly into `view.target.view` (`packages/engine/src/render-graph/opaque-pass-2d-node.ts:57`, `packages/engine/src/render-graph/transparent-pass-2d-node.ts:48-49`). Compositing accumulated light *into the geometry passes' output* would have required reading-while-writing the surface, which WebGPU does not allow. The Phase 9.1 redirect introduces a per-camera intermediate `baseColor` texture; the geometry passes write into it, the new accumulation pass writes into a sibling `lightAccum` texture, and a new composite pass multiplies the two and writes the product to `view.target.view`. Cameras without lighting installed keep writing to `view.target.view` directly — the geometry-pass redirect falls back to that view whenever no `ViewLight2dTargets` entry exists, so the unlit code path is preserved bit-for-bit.

Out of scope for this ADR (each documented in §"Not yet done" with its trigger):

- **`SpotLight2d` / `DirectionalLight2d` / `AmbientLight2d` as a component.** Phase 9.1 covers the omnidirectional radial-falloff case only. Ambient is handled by `Light2dSettings.ambient` (the accumulation pass's clear value); a real `AmbientLight2d` component lands when a consumer needs multiple ambient zones.
- **2D shadow occluders.** Roadmap §9.4 (line-of-sight blocking via segments or polygons). Adds an occluder pass between accumulation and composite.
- **Normal-map-aware 2D lighting.** Roadmap §9.5; capability-gated by `RendererCapabilities`.
- **HDR / tonemapping coupling.** Phase 12. Today the composite output is clamped to the surface format (typically `rgba8unorm`). `lightAccum` is already `rgba16float` so the accumulation pipeline is HDR-ready when composite is upgraded.
- **Composite modes `'add'` and `'screen'`.** Reserved on `Light2dSettings.compositeMode`; the v1 composite WGSL hardcodes multiply. The follow-on either branches the shader or ships separate WGSL paths.
- **Light culling / spatial structures.** v1 iterates every visible light into every Core2d camera's accumulation. Spatial culling lands when a measured-perf consumer pushes a workload past the prepare/queue budget.
- **Per-light `Z`-range filtering.** A light that affects only sprites at a specific Z layer requires extracting the geometry's Z into the accumulation pass. Defer until a consumer asks.
- **`Material2d` shader response to lighting.** `ColorMaterial2d` stays unlit; lighting affects it only through the composite multiply, same as sprites. A future `LitMaterial2d` reads `lightAccum` directly inside its fragment shader.
- **Cross-frame instance buffer persistence / incremental rebuild.** Mirrors ADR-0036's deferral — the per-frame rebuild stays cheap until a measured-perf consumer asks.

## Decision

1. **Restructure Core2d into base-color → composite.** A new render-world resource `ViewLight2dTargets` caches, per main-world camera entity, a `baseColor` texture matching the camera's color-target format and a `lightAccum` texture in fixed `rgba16float`. The Core2d geometry pass nodes look up that resource and redirect their `colorAttachments[0].view` from `view.target.view` to the cache entry's `baseColorView` when one exists; when no entry exists (no `Light2dPlugin` installed, or first-frame race before the pipeline is ready), they fall back to `view.target.view`. This is the load-bearing decision in this slice — every later 9.x item (spot lights, shadows, normal maps, HDR) builds on the same intermediate.

2. **`ViewLight2dTargets` lifecycle mirrors `ViewDepthCache` byte-for-byte.** Keyed by the stable main-world `sourceEntity` (render-world entity ids reset every frame per ADR-0019; main-world entity ids persist). Populated by a new `light2d-prepare-targets` system in `RenderSet.Prepare`. Each frame the system walks `SortedCameras.views`, allocates / reuses textures sized to `(view.target.width, view.target.height, view.target.format)`, and garbage-collects entries whose camera disappeared. Surface-resize handling is automatic — the per-frame mismatch check against the cached dimensions triggers reallocate, exactly as `ViewDepthCache` handles depth resize in `camera-plugin.ts:159-210` + `406-413`.

3. **`PointLight2d` component is Bevy-shaped: RGB + intensity, range + radius, no alpha-baked tricks.** Fields: `color: Vec3` (linear), `intensity: number` (unitless multiplier — no Lumens / Watts), `range: number` (outer world-space radius), `radius: number` (inner full-bright radius). Required components `[Transform, GlobalTransform, Visibility, InheritedVisibility, ViewVisibility]` so the visibility pipeline applies to lights just like sprites — invisible lights contribute nothing to accumulation. The auto-aggregate `ViewVisibility` already encodes render-layer / frustum culling outcomes; the queue system reads it directly. Per-camera per-light visibility (a Vulkan-style culling list) lands when a measured-perf consumer asks.

4. **`Light2dSettings` resource carries the per-frame ambient floor and the composite mode.** `ambient: Vec4` (default `(0, 0, 0, 1)`) is the accumulation pass's clear value — the minimum lighting any pixel sees before per-light contributions add on top. `compositeMode: 'multiply' | 'add' | 'screen'` defaults to `'multiply'`; v1 hardcodes the multiplicative branch in the composite WGSL and ignores other modes at runtime. Forward-compatibility ergonomics: consumers can author the field today and the shader switch lands later.

5. **Two new render-graph nodes are inserted into the Core2d sub-graph.** `Light2dAccumulationPass2dNode` runs *before* `OpaquePass2dNode`; `Light2dCompositePass2dNode` runs *after* `TransparentPass2dNode`. Resulting chain per Core2d camera: `Light2dAccumulationPass2d → OpaquePass2d → TransparentPass2d → Light2dCompositePass2d`. Wiring is one-shot at plugin build time — `Light2dPlugin.build()` calls `RenderGraph.getSubGraph(Core2dLabel).addNode/addEdge`, which the existing render-graph API exposes pre-freeze. The two new labels are exported from `engine/src/index.ts` for parity with the existing pass labels.

6. **Accumulation pipeline.** Single non-specialised pipeline. Vertex layout (two buffers): `@location(0)` unit-quad UV at vertex step, `@location(2)` per-instance `center.xy + range + radius` (vec4), `@location(3)` per-instance `color.rgb + intensity` (vec4). Vertex shader places the quad at world position `center + (quad_uv * 2 - 1) * range` — a `2 * range × 2 * range` axis-aligned square centred on the light, so fragments outside the falloff are never shaded. Fragment shader computes `falloff = 1.0 - smoothstep(radius, range, distance(world_pos, light_center))`, multiplies by `color * intensity`, and emits at full alpha. Blend mode is additive `One/One`. Target format is fixed `rgba16float` so additive overlap can exceed `1` per channel without clipping. The pipeline depends on `ViewBindGroupCache.layout` (from `CameraPlugin`) for its `@group(0)` view bind group, so initialisation is deferred via an `ensureInitialised` returns-false-when-not-ready pattern — same as `SpritePipeline.ensureInitialised` (`sprite-pipeline.ts:83-151`).

7. **Composite pipeline.** Surface-format-specialised via `SpecializedRenderPipelines<{ surfaceFormat }>`. Vertex shader emits a fullscreen triangle from `@builtin(vertex_index)` (no vertex buffer bound; `pass.draw(3, 1, 0, 0)`). Bind group `@group(0)` carries `baseColor` at binding 0, `lightAccum` at binding 1, a `filtering` sampler at binding 2. Fragment hardcodes `baseColor.rgb * lightAccum.rgb` and writes `base.alpha` straight through. Blend disabled. The per-camera bind group is built by `light2d-prepare-targets` whenever the underlying textures are reallocated (size / format change) and stored on the cache entry; the node looks it up and binds it, eliminating per-frame bind-group churn.

8. **Queue system packs once, batches per camera.** `light2d-queue` runs in `RenderSet.Queue`. It iterates `(PointLight2d, GlobalTransform, ViewVisibility)` via `Extract(...)` (same shape as sprite-plugin) to read the main world from the render schedule. Visible lights are packed once into the shared `Light2dInstanceBuffer` (32 bytes per light); one `Light2dBatch` is emitted per Core2d camera pointing at the packed range `[0, count]`. In v1 every Core2d camera sees the same visible set (no per-camera render-layer filtering of lights yet), so the buffer is not duplicated per camera. Empty-light frames still emit a `count = 0` batch per camera so the accumulation pass opens and performs its ambient clear — the composite always has a known `lightAccum` to read.

9. **`Light2dInstanceBuffer` mirrors `SpriteInstanceBuffer` byte-for-byte.** Same growable VBO + scratch + pending-destroy quarantine pattern (`sprite-instance-buffer.ts:26-91`). 1.5× growth factor, minimum 64 lights, one-frame quarantine of the prior buffer post-resize.

10. **Plugin lifecycle.** `Light2dPlugin.build` registers WGSL idempotently, inserts the five new resources idempotently (matches `SpritePlugin.build` lines 74-99), mutates the Core2d sub-graph with the two new nodes + edges, and registers the prepare + queue systems. No `finish` / `cleanup` hooks today — the pipeline's `dispose()` method ships for tests / future teardown but is not auto-called.

11. **No invasion of `CameraView`.** The lighting plugin owns its target lifecycle in a sibling resource (`ViewLight2dTargets`), not as a field on `CameraView`. Removing the plugin is one `app.addPlugin` line — no Camera mutation. The Core2d phase nodes' lighting-aware redirect is gated on the resource's presence: `app.getResource(ViewLight2dTargets)?.perCamera.get(view.sourceEntity)?.baseColorView ?? view.target.view`.

Composition-only. No abstract base classes; the plugin shape is a `PluginObject` and the systems are functions over resources + queries.

## Consequences

**Easier:**

- Real 2D lighting works end-to-end in the playground (`?mode=lights`). Three static + one orbiting `PointLight2d` over a 4×3 grid of checker sprites produces the expected halo+ambient-shadow look without per-pixel glue code.
- The geometry-pass redirect is one line in each Core2d phase node and is null-safe — no `Light2dPlugin` in the App means the redirect resolves to `view.target.view` and every existing sprite / Material2d / playground test continues to pass unchanged.
- The lighting target lifecycle reuses the depth-target precedent verbatim. Adding `SpotLight2d` / shadows later only needs new components and a queue extension; no new lifecycle primitives.
- The composite pass writes the final surface in one fullscreen triangle. Adding `add` / `screen` modes is one WGSL switch and one specialisation key bit.
- A new HDR camera flag can flip `baseColor`'s format to `rgba16float` without touching the rest of the pipeline — the accumulation target is already in that format.

**Harder / accepted trade-offs:**

- **Two extra GPU passes per Core2d camera frame.** Accumulation + composite each open a `RenderPassEncoder`. With a Core2d camera at 1920×1080 the composite pass alone costs ~2 MP of fragment work plus two texture samples. On WebGPU's underlying APIs (Metal / Vulkan / D3D12) that's a few hundred microseconds at most, but on weaker hardware it shows up in the per-frame budget. Composite cost is GPU-fragment dominated and not measurable from the headless bench harness; see `docs/backlog/integrated-frame-benches.md` for per-system cost-attribution.
- **Two extra per-camera textures.** A 1920×1080 surface costs an extra 1920×1080×4 (`rgba8unorm` baseColor) + 1920×1080×8 (`rgba16float` lightAccum) = ~24 MB per active Core2d camera. Multi-window or split-screen scenes scale linearly. Acceptable today; revisited if a workload pushes against VRAM headroom.
- **`view.target.view` is no longer the geometry passes' write target when lighting is installed.** Code reading `RenderContext.surfaceView` inside an opaque- or transparent-phase draw closure now sees the baseColor view, not the surface — `surfaceView` is documented as "the camera's color attachment for the active pass" so this is semantically correct, but a consumer that hard-coded `surfaceView === view.target.view` would break. No engine-internal consumer does so.
- **First-frame race deferred.** The accumulation pipeline depends on `ViewBindGroupCache.layout` (camera-plugin first-frame allocation). On the very first frame `Light2dPipeline.ensureInitialised` returns false, the cache stays empty, the geometry passes fall back to `view.target.view`, and the composite pass is a no-op. Lighting kicks in one frame later. Identical pattern to `SpritePipeline` (sprite-pipeline.ts:104-110).
- **`compositeMode` field carries a future commitment.** Shipping the field today with only `'multiply'` honored means `'add'` / `'screen'` selections fail silently in v1. The TSDoc + this ADR are explicit. The cost of the alternative (deferring the field) is a breaking-change surface bump when modes arrive; one-time runtime no-op is the cheaper trade.

## Not yet done

- **`SpotLight2d` / `DirectionalLight2d`.** Roadmap §9.1 follow-ons. Each adds a component + queue branch + WGSL variant; `Light2dInstanceBuffer` likely splits per-light-type or grows a kind-discriminator field.
- **`AmbientLight2d` as a real component.** v1 piggybacks ambient onto `Light2dSettings.ambient`. A per-scene-region ambient zone requires the component.
- **2D shadow occluders.** Roadmap §9.4.
- **Normal-map-aware 2D lighting.** Roadmap §9.5; capability-gated.
- **HDR / tonemapping coupling.** Phase 12. `lightAccum` is already `rgba16float`; the composite output is the limiting factor.
- **Composite modes `'add'` and `'screen'`.** Either a runtime branch in one shader or specialised WGSL paths. The composite specialisation key only has surface format today.
- **Light culling / spatial structures.** v1 iterates every visible light.
- **Per-light `Z`-range filtering.** Requires geometry-Z extraction into the accumulation pass.
- **`Material2d` shader response to lighting.** A future `LitMaterial2d` consumes `lightAccum` directly.
- **Cross-frame instance buffer persistence / incremental rebuild.** Same deferral shape as ADR-0036 §"Not yet done".

## Implementation

- `packages/engine/src/light2d/index.ts` — re-exports the public surface.
- `packages/engine/src/light2d/point-light-2d.ts` — `PointLight2d`, `PointLight2dOptions`.
- `packages/engine/src/light2d/light-2d-settings.ts` — `Light2dSettings`, `Light2dCompositeMode`.
- `packages/engine/src/light2d/light-2d-targets.ts` — `ViewLight2dTargets`, `Light2dCameraTargets`, `prepareLight2dTargets`.
- `packages/engine/src/light2d/light-2d-instance-buffer.ts` — `Light2dInstanceBuffer`.
- `packages/engine/src/light2d/light-2d-batch.ts` — `Light2dBatch`, `Light2dPreparedBatches`, `packLightInstance`, `LIGHT2D_INSTANCE_BYTE_SIZE`, `LIGHT2D_INSTANCE_FLOAT_COUNT`.
- `packages/engine/src/light2d/light-2d-pipeline.ts` — `Light2dPipeline`, `Light2dCompositeKey`, `LIGHT2D_ACCUM_FORMAT`.
- `packages/engine/src/light2d/light-2d-accumulation.wgsl.ts` — `LIGHT2D_ACCUMULATION_WGSL`.
- `packages/engine/src/light2d/light-2d-composite.wgsl.ts` — `LIGHT2D_COMPOSITE_WGSL`.
- `packages/engine/src/light2d/light-2d-plugin.ts` — `Light2dPlugin`, `queueLight2dInstances`.
- `packages/engine/src/light2d/point-light-2d.test.ts` — component-level coverage.
- `packages/engine/src/light2d/light-2d-plugin.test.ts` — sub-graph node order, drawIndexed presence, composite always running, target sizing, sprite redirect, empty-light batch emission, ambient settings, instance-buffer packing.
- `packages/engine/src/render-graph/light2d-accumulation-pass-2d-node.ts` — `Light2dAccumulationPass2dNode`, `Light2dAccumulationPass2dLabel`.
- `packages/engine/src/render-graph/light2d-composite-pass-2d-node.ts` — `Light2dCompositePass2dNode`, `Light2dCompositePass2dLabel`.
- `packages/engine/src/render-graph/opaque-pass-2d-node.ts` (modified) — color attachment + `RenderContext.surfaceView` redirect through `ViewLight2dTargets`; falls back to `view.target.view` when no entry.
- `packages/engine/src/render-graph/transparent-pass-2d-node.ts` (modified) — same redirect.
- `packages/engine/src/render-graph/index.ts` (modified) — re-exports the two new node labels + nodes.
- `packages/engine/src/index.ts` (modified) — re-exports the new public surface (types + values).
- `packages/engine/bench/light-2d.bench.ts` — `packLightInstance` throughput at 100 / 1 000 / 5 000 lights.
- `packages/engine/bench/index.ts` (modified) — registers the new bench.
- `apps/playground/src/lights-showcase-plugin.ts` — 12-sprite grid + 4 `PointLight2d` (3 static, 1 orbiting), `Light2dSettings.ambient = (0.15, 0.15, 0.15, 1)`.
- `apps/playground/src/main.ts` (modified) — adds `?mode=lights` branch.
