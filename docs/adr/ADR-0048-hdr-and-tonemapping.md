# ADR-0048: Phase 12.1/12.2 — HDR per-camera + tonemapping

- **Status:** Accepted
- **Date:** 2026-05-28

## Context

Renderer-roadmap Phase 12 (`docs/roadmap/renderer.md`) opens the post-processing
chain. `Camera.hdr: boolean` has existed on the `Camera` component since the
ADR-0020 camera phase landed (`packages/engine/src/camera/camera.ts:208`) but no
consumer has ever honoured it — every pass writes straight to `view.target.view`
in whatever format the camera's resolved target carries (typically
`bgra8unorm`). The result is that any rendered value &gt; 1.0 is clipped at the
fragment, before any lighting / accumulation downstream sees it. ADR-0044's 3D
analytic lights and ADR-0037/0041/0043's 2D lighting both already produce
values that can legitimately exceed 1.0 (intense sources, additive
accumulation), so the engine has had real HDR signal flowing into LDR storage
for two whole lighting phases. Phase 12.1 ("HDR per-camera") closes that gap;
Phase 12.2 ("Tonemapping") provides the matching display-transform.

The pieces this ADR layers on are all in place: `Light2dCompositePass2dNode`
(`packages/engine/src/render-graph/light2d-composite-pass-2d-node.ts:43-88`) is
a complete precedent for the kind of full-screen pass tonemapping needs — a
fullscreen-triangle WGSL shader, a `{ surfaceFormat, mode }` pipeline key, and
a `ViewNode` inserted after the geometry passes. `ViewLight2dTargets`
(`packages/engine/src/light2d/light-2d-targets.ts:71-186`) is the precedent for
a per-camera intermediate texture cached across frames. The `PipelineCache`
(`packages/engine/src/shader/pipeline-cache.ts:163-176`) already keys on
color-target format, so swapping a pass's color attachment from `bgra8unorm` to
`rgba16float` automatically specializes pipelines through the existing cache —
no `PipelineCache` change is required, only that the format flowing into the
key reflects the camera's HDR choice. `MaterialPipelineKey2d` already declares
an `hdr: boolean` slot (`packages/engine/src/material2d/material-2d.ts:53`)
that every call site currently hardcodes to `false` — this ADR finally wires
it.

This ADR seals **both** Phase 12.1 and 12.2 in one document because the two
slices are coupled: an HDR intermediate with no display transform sitting at
the end is unused; a tonemap pass with no HDR source upstream is a no-op. The
same way ADR-0044 packaged Phase 10.1 with the `GpuLights`/`prepare_lights`
half of 10.3, and ADR-0047 the engine-wide kernel-dispatch infra, the
HDR-target + tonemap-pass pair is one architectural decision.

Out of scope for this ADR (each with its trigger):

- **`tony_mc_mapface`.** The remaining operator in the roadmap's Phase 12.2
  list. Bevy ships it as the default and it is widely considered the
  best-looking general-purpose tonemap, but it is **LUT-driven** — a 48×48×48
  `Rgba16Float` cubic table baked from Tomasz Stachowiak's reference
  implementation. The engine has no asset / texture-loader infrastructure for
  HDR LUTs yet. Tracked in `docs/backlog/tonemapping-tony-mcmapface.md`,
  gated on `docs/roadmap/asset-system.md`.
- **MSAA × HDR.** Phase 12.3 (`Camera.msaaWriteback`) is the next slice; the
  current engine effectively runs `msaaSamples = 1` everywhere. The HDR
  intermediate this ADR allocates is fixed at `sampleCount: 1`. When MSAA
  lands, the resolve-target / multisample-to-tonemap path is its own ADR.
- **Multi-pass post-processing chain (ping-pong / `out_texture`).** Bevy's
  `ViewTarget` carries a `main_texture`/`out_texture` pair so multiple
  post-process passes can ping-pong. This ADR ships exactly one HDR-in /
  LDR-out hop (no bloom, no FXAA, no DoF), so a single `mainColorTarget` field
  alongside the existing `target` is sufficient. The ping-pong story arrives
  with the first ADR that adds a second post-process pass (Phase 12.4 bloom is
  the likely trigger).
- **`ColorGrading`.** Bevy's pre-tonemap exposure / contrast / saturation /
  gamma component. Separate follow-on; the operators here all consume a raw
  linear HDR value and do not yet apply an exposure stop.
- **HDR output to an HDR-capable canvas.** WebGPU's
  `GPUCanvasConfiguration.toneMapping` / `display-p3` / future canvas HDR
  signal are display-side concerns. The tonemap here always targets the
  camera's existing SDR swapchain (`view.target.format`, typically
  `bgra8unorm`).
- **`OpaqueRendererMethod` (deferred shading).** Still absent (ADR-0028 §17).
  This ADR is forward-only.

## Decision

1. **`Camera.hdr === true` triggers a per-camera `rgba16float` intermediate
   render target.** Allocated lazily in `RenderSet.Prepare` and cached across
   frames in a new `ViewHdrTargets` resource keyed by main-world camera entity,
   the same shape as `ViewDepthCache` and `ViewLight2dTargets`. Reallocated on
   size change; garbage-collected at the end of prepare for cameras absent from
   `SortedCameras.views`. Format is unconditionally `rgba16float` — the only
   WebGPU format with both `RENDER_ATTACHMENT` and `TEXTURE_BINDING` usage at
   half-float precision that ships on every WebGPU implementation. Usage is
   `RENDER_ATTACHMENT | TEXTURE_BINDING`.

2. **`CameraView` gains a `mainColorTarget: ResolvedRenderTarget` field
   alongside the existing `target`.** When `view.hdr === true`,
   `mainColorTarget` points at the HDR intermediate (view + format
   `'rgba16float'`); when `view.hdr === false`, `mainColorTarget === target`
   (same object reference). `target` keeps its existing meaning — the camera's
   final output, the surface or texture the user asked the camera to draw to.
   The split means every geometry / composite pass writes to `mainColorTarget`
   unconditionally, and the new tonemap node reads `mainColorTarget` and
   writes `target` when those are different objects. Non-HDR cameras keep
   running through identical code paths because `mainColorTarget === target`.

3. **All geometry-side passes write to `view.mainColorTarget.view` instead of
   `view.target.view`.** Touched nodes: `OpaquePass2dNode`,
   `TransparentPass2dNode`, `OpaquePass3dNode`, `TransparentPass3dNode`,
   `Light2dCompositePass2dNode`. The `RenderContext.surfaceView` field follows
   the same pointer. The `ViewLight2dTargets` `baseColor`-redirect logic in
   `OpaquePass2dNode` remains intact and continues to redirect into the
   per-camera baseColor texture when the light plugin is installed — the only
   change is that `baseColor`'s format now mirrors `view.mainColorTarget.format`
   (so it becomes `rgba16float` when HDR is on, preserving HDR values through
   the geometry → composite chain).

4. **Pipeline specialization keys take the format / HDR signal from the view.**
   Material2d's existing hardcoded `hdr: false` literals are replaced with
   `view.hdr`, and `view.target.format` references in the key are replaced with
   `view.mainColorTarget.format`. Material3d's pipeline key gains an `hdr:
   boolean` and routes format from `view.mainColorTarget.format`. The Sprite
   pipeline's specialization key gains the same `hdr: boolean` slot.
   Light2d's composite pipeline keys on `view.mainColorTarget.format` instead
   of `view.target.format`. The 2D light **accumulation** texture stays
   `rgba16float` regardless (it always has been; no change). The `PipelineCache`
   already hashes color-target format, so distinct
   `bgra8unorm` / `rgba16float` pipelines are produced automatically — this
   ADR introduces no `PipelineCache` change.

5. **A new `Tonemapping` per-camera component selects the display-transform.**
   String-literal union, mirroring `ShadowFilteringMethod`'s shape from
   ADR-0047:

   ```ts
   type TonemappingMethod =
     | 'none'
     | 'reinhard'
     | 'reinhard_luminance'
     | 'aces_fitted'
     | 'agx'
     | 'blender_filmic'
     | 'somewhat_boring_display_transform';
   ```

   Per-camera (not a global resource): a 3D HDR viewport, a 2D split-screen
   HUD camera, and an offscreen-render-target probe camera will all reasonably
   want different operators (or none). `Camera2d({ hdr: true })` and
   `Camera3d({ hdr: true })` bundle factories auto-insert
   `Tonemapping({ method: 'agx' })` when no override is passed; users can pass
   `tonemapping: 'reinhard'` etc. to override, or spawn their own `Tonemapping`
   component explicitly. `agx` is the default because (a) Bevy's current
   default, (b) no LUT required, (c) neutral / forgiving curve. `none` is the
   "pass-through" operator that still does the HDR→LDR copy but applies no
   curve (clipping the result) — useful for debugging and for the few cameras
   that want raw HDR-clipped output. `tony_mc_mapface` is **not** in this union
   for this slice; see backlog.

6. **`TonemappingNode` is a `ViewNode` inserted at the tail of both
   `Core2d` and `Core3d` sub-graphs.** One shared node implementation; two
   labels — `TonemappingPass2dLabel` and `TonemappingPass3dLabel`. The node:
   skips when `view.hdr === false` (so non-HDR cameras pay nothing); skips when
   no `Tonemapping` component is extracted for the camera (a camera with
   `hdr: true` but the user explicitly removed the component); otherwise opens
   a render pass with a single color attachment = `view.target.view`,
   `loadOp: 'clear'`, format = `view.target.format`, draws a fullscreen
   triangle (`pass.draw(3, 1, 0, 0)`) with the bind group carrying the input
   `mainColorTarget` texture + a `filtering` linear-clamp sampler, and ends.
   The 2D edge ordering is
   `… → TransparentPass2dLabel → Light2dCompositePass2dLabel? →
   TonemappingPass2dLabel` (the composite node is itself optional via the
   light plugin); the 3D edge is
   `… → TransparentPass3dLabel → TonemappingPass3dLabel`.

7. **The tonemap pipeline specializes on `{ outputFormat, method }`.** Single
   WGSL module (`retro_engine::tonemapping`) with the fullscreen-triangle
   vertex shader and one fragment entry point per operator (`fs_none`,
   `fs_reinhard`, `fs_reinhard_luminance`, `fs_aces_fitted`, `fs_agx`,
   `fs_blender_filmic`, `fs_somewhat_boring`). Pipeline specialization selects
   the entry point — mirrors `Light2dCompositePass2dNode`'s
   `fs_multiply` / `fs_add` / `fs_screen` shape exactly. Bind group `@group(0)`:
   `binding(0)` = `texture_2d<f32>` HDR input, `binding(1)` = `sampler`. The
   sampler is a single engine-owned linear-clamp; no per-camera sampler.

8. **Operator math.** All operators consume a linear HDR `vec3` and return a
   linear HDR `vec3` ready to be written directly to the swapchain (sRGB
   encoding is handled by the swapchain format's transfer function, same as
   today's non-HDR path). Implementations match well-known references — these
   are not novel fits:
   - `none` — identity (`color`), clipped by the LDR storage.
   - `reinhard` — `color / (1 + color)`, per-channel.
   - `reinhard_luminance` — luminance-preserving `Y / (1 + Y)` with chrominance
     ratio kept (so saturated highlights don't desaturate).
   - `aces_fitted` — Stephen Hill's RRT+ODT fit (the `ACESFitted` curve used
     throughout the industry; not the cheap "Krzysztof Narkowicz" approximation,
     which is too dark in the shadows).
   - `agx` — Troy Sobotka's AgX, polynomial approximation (no LUT). Linear in
     log space; very forgiving on intense sources.
   - `blender_filmic` — polynomial approximation of Blender's filmic curve.
   - `somewhat_boring_display_transform` — Tomasz Stachowiak's
     "Somewhat-Boring" curve. Cheap, predictable, mid-saturation desaturation.

9. **`TonemappingPlugin` is auto-installed by `CorePlugin`.** Same precedent as
   `CameraPlugin`. Its `build()` registers the WGSL module with `ShaderRegistry`
   (`retro_engine::tonemapping`), inserts the `TonemappingPipeline` render-world
   resource, registers the extraction system (`extractTonemapping` in
   `RenderSet.Extract`, populating a `ViewTonemapping` resource keyed by source
   entity), and adds the two `TonemappingNode` labels to the `Core2d` /
   `Core3d` sub-graphs after the registered transparent / composite nodes. HDR
   cameras work out of the box; users do not have to add the plugin manually.

Composition-only throughout. `Tonemapping` is a plain component; the per-camera
HDR target is a cache resource (`ViewHdrTargets`); the extracted-tonemapping
table is a cache resource (`ViewTonemapping`); the pipeline is a render-world
resource; the node is a `ViewNode` like every other phase node. No inheritance,
no decorators, no capability flag.

## Consequences

**Easier:**

- HDR is a one-line opt-in (`Camera2d({ hdr: true })` /
  `Camera3d({ hdr: true })`). The default tonemap is already there; an HDR
  camera looks correct out of the box.
- Operator choice is a single field — `cmd.spawn(...Camera3d({ hdr: true,
  tonemapping: 'aces_fitted' }))` — and per-camera, so a debug HUD camera can
  use `'none'` while the main camera uses `'agx'`.
- The PBR + 2D lighting paths that legitimately produce &gt; 1.0 values now
  preserve them through the geometry → composite chain (the baseColor
  intermediate flips to `rgba16float` when HDR is on), so the eventual bloom /
  exposure ADRs have real HDR signal to work with.
- The per-camera target indirection on `CameraView.mainColorTarget` is the
  same shape Bevy's `ViewTarget` will eventually grow into (`main_texture`
  half of the ping-pong), so Phase 12.4 (bloom) can extend without reshaping
  this ADR.
- Zero binding-model or HAL change. The pipeline cache already keys on color
  format; geometry pipelines recompile transparently when the format flips.
- WebGL2-reachable. `rgba16float` colour-renderability is in the WebGL2 base
  feature set (`EXT_color_buffer_half_float`); the tonemap is a single
  fragment-shader pass with no compute / storage / indirect dependency.

**Harder / accepted trade-offs:**

- **Memory grows by one `width × height × 8 B` HDR texture per HDR camera.**
  At a 1920×1080 HDR camera that's ≈16.6 MiB. Garbage-collected like
  `ViewDepthCache` so disabling `hdr` returns the memory the next frame.
- **One additional render pass per HDR camera per frame.** A 1920×1080
  fragment-only pass with two samples and a tiny inline curve — negligible on
  any WebGPU-capable GPU but real; the new `tonemapping.bench.ts` measures it.
- **Pipeline cache grows by one entry per (Material × format × hdr-bool) pair.**
  Materials drawn through HDR cameras and non-HDR cameras in the same App
  hold two pipelines. Acceptable; the cache already deduplicates by descriptor
  hash, and most Apps use one tonemap operator at a time.
- **No `tony_mc_mapface` until the asset system lands.** AgX is the chosen
  default precisely because it is the best-looking LUT-free option; users who
  specifically want Tony today can substitute `'agx'` and switch later.
- **Format mismatch when an HDR camera targets a swapchain whose preferred
  format is, say, `rgba8unorm` instead of `bgra8unorm`.** No behaviour
  difference — `view.target.format` is read at frame time and passed straight
  into the tonemap pipeline key, so whatever the surface format is gets the
  matching specialization.
- **MSAA is gated to msaa = 1 for HDR cameras.** The HDR intermediate is
  `sampleCount: 1`. When 12.3 lands, the resolve target needs a separate ADR.

## Not yet done

- **`tony_mc_mapface` operator** — backlog: gated on the asset system (LUT
  loading + 3D-texture sampler binding).
- **`ColorGrading` component** (pre-tonemap exposure / contrast / saturation /
  gamma). Separate follow-on; would compose with this ADR's `Tonemapping`.
- **Multi-pass post-processing chain** — when Phase 12.4 (bloom) lands, this
  ADR's single `mainColorTarget` likely splits into a Bevy-style
  `main_texture` / `out_texture` pair with ping-pong. New ADR at that point.
- **MSAA × HDR** — Phase 12.3 ADR.
- **Per-camera kernel choice combined with multi-camera split-screen** — the
  shape is already correct (per-camera `Tonemapping`); the bench coverage
  doesn't yet measure the multi-camera path.

## Implementation

- `packages/engine/src/camera/camera.ts` (modified) — `CameraView` gains
  `mainColorTarget: ResolvedRenderTarget` and `hdr: boolean`.
- `packages/engine/src/camera/extracted.ts` (modified) — `ExtractedCamera`
  gains `hdr: boolean`; new `ViewHdrTargets` cache class
  (`perCamera: Map<Entity, { texture, view, width, height,
  format: 'rgba16float' }>`).
- `packages/engine/src/camera/camera-plugin.ts` (modified) — `extractCameras`
  copies `Camera.hdr` into the `ExtractedCamera`; `prepareCameras` allocates /
  reuses the HDR texture when `extracted.hdr === true`, builds
  `mainColorTarget = { view, format: 'rgba16float', width, height }`, GC step
  prunes `ViewHdrTargets` for cameras absent from `SortedCameras.views`.
- `packages/engine/src/camera/camera-bundles.ts` (modified) — `Camera2d` and
  `Camera3d` accept `tonemapping?: TonemappingMethod`; insert
  `new Tonemapping({ method: 'agx' })` by default when `hdr: true` and no
  override is passed.
- `packages/engine/src/render-graph/opaque-pass-2d-node.ts` (modified) — writes
  to `view.mainColorTarget.view` (still overridable by
  `ViewLight2dTargets.baseColor` redirect).
- `packages/engine/src/render-graph/transparent-pass-2d-node.ts` (modified) —
  writes to `view.mainColorTarget.view`.
- `packages/engine/src/render-graph/opaque-pass-3d-node.ts` (modified) —
  writes to `view.mainColorTarget.view`.
- `packages/engine/src/render-graph/transparent-pass-3d-node.ts` (modified) —
  writes to `view.mainColorTarget.view`.
- `packages/engine/src/render-graph/light2d-composite-pass-2d-node.ts`
  (modified) — writes to `view.mainColorTarget.view`; pipeline key sources
  format from `view.mainColorTarget.format`.
- `packages/engine/src/material2d/material-2d-plugin.ts` (modified) — replaces
  hardcoded `hdr: false` and `view.target.format` with `view.hdr` /
  `view.mainColorTarget.format` in the queue-side specialization-key path.
- `packages/engine/src/material/material-plugin.ts` (modified) — adds `hdr` to
  the Material3d pipeline key, routes format from `view.mainColorTarget.format`.
- `packages/engine/src/sprite/sprite-pipeline.ts` (modified) — adds `hdr` to
  the sprite pipeline key, routes format from `view.mainColorTarget.format`.
- `packages/engine/src/light2d/light-2d-targets.ts` (modified) — `baseColorTex`
  format mirrors `view.mainColorTarget.format`.
- `packages/engine/src/tonemapping/tonemapping.ts` (new) — `TonemappingMethod`
  union, `TONEMAPPING_METHODS` frozen list, `Tonemapping` component.
- `packages/engine/src/tonemapping/tonemapping.wgsl.ts` (new) —
  `TONEMAPPING_WGSL` source: fullscreen triangle vertex + one fragment entry
  point per operator.
- `packages/engine/src/tonemapping/tonemapping-pipeline.ts` (new) —
  `TonemappingPipeline` render-world resource (layout, sampler, specialized
  render pipelines keyed on `{ outputFormat, method }`).
- `packages/engine/src/tonemapping/tonemapping-node.ts` (new) —
  `TonemappingPass2dLabel`, `TonemappingPass3dLabel`,
  `makeTonemappingNode(label)` factory returning the shared `ViewNode`
  implementation.
- `packages/engine/src/tonemapping/tonemapping-plugin.ts` (new) —
  `TonemappingPlugin`; auto-installed by `CorePlugin`. Inserts the pipeline +
  `ViewTonemapping` resources, registers the extraction system, registers the
  WGSL module, adds the two nodes to the sub-graphs after composite /
  transparent.
- `packages/engine/src/index.ts` (modified) — re-exports `Tonemapping`,
  `TonemappingMethod`, `TONEMAPPING_METHODS`, `TonemappingPlugin`.
- `packages/engine/src/tonemapping/tonemapping.test.ts` (new) — operator
  union shape; per-camera component default.
- `packages/engine/src/tonemapping/tonemapping-plugin.test.ts` (new) —
  graph-insertion order in both sub-graphs; pipeline cache produces distinct
  entries for distinct `(format, method)` pairs.
- `packages/engine/src/camera/camera-plugin.test.ts` (modified) — HDR camera
  yields `mainColorTarget.format === 'rgba16float'`; non-HDR camera yields
  `mainColorTarget === target`.
- `packages/engine/bench/tonemapping.bench.ts` (new) — per-frame cost of the
  tonemap pass against an HDR-off baseline.
- `apps/playground/src/lit-showcase-plugin.ts` (modified) — `?hdr=1` toggles
  `Camera3d({ hdr: true })`, `?tm=<method>` selects the operator.
