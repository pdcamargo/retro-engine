# ADR-0053: temporal anti-aliasing — CPU camera jitter, history reprojection, and a per-camera HDR post-process handoff

- **Status:** Accepted
- **Date:** 2026-05-31

## Context

Phase 12.6. TAA is the canonical consumer of the screen-space motion-vector +
depth prepass ([ADR-0050](ADR-0050-screen-space-prepass-family.md) /
[ADR-0051](ADR-0051-screen-space-motion-vectors.md)) and the second HDR-space
post pass after motion blur ([ADR-0052](ADR-0052-screen-space-motion-blur.md)).
It jitters the camera a sub-pixel amount each frame and blends the current frame
against a reprojected accumulation of previous frames, converging toward a
supersampled image along edges.

Three constraints shaped the design:

- **The depth prepass and the main pass must agree on jittered geometry.** The
  prepass writes depth with `view.view_proj`; the opaque pass *loads* that depth
  and tests it with `depthCompare: 'less-equal'`. If only the main pass were
  jittered, its sub-pixel-shifted fragments would be rejected against an
  un-jittered depth buffer at silhouettes — the same coplanar-rejection failure
  class found during ADR-0052 bring-up. So jitter must live in the shared
  `view_proj`, and motion vectors (which must stay jitter-free, or the jitter
  pollutes the velocities the resolve reprojects along) need a *separate* clean
  matrix.

- **The swapchain is not sampleable and the HAL has no texture-to-texture copy.**
  As with motion blur, reading the rendered scene requires `Camera.hdr = true`
  (the `rgba16float` intermediate the geometry passes write), so TAA is an
  HDR-space pass that runs before tonemapping.

- **A third HDR post pass arrived.** ADR-0052 flagged that once a third pass
  (TAA) sat in front of motion blur, the per-pass hardcoded "what do I read"
  lookups in the tonemap node would not compose — motion blur hardcoded the raw
  HDR intermediate as its input and would discard TAA's output.

## Decision

Add a per-camera `Taa` component and an HDR-space full-screen resolve that runs
`Transparent → TAA → MotionBlur → Tonemapping`.

- **Camera jitter is baked on the CPU.** When a camera has `Taa`, a Halton(2,3)
  sub-pixel offset (cycled over 8 frames) is generated in `RenderSet.Extract`,
  published into a `ViewJitter` resource, and folded into the camera's
  projection in `RenderSet.Prepare` — `view_proj` becomes the jittered matrix
  the geometry and depth-prepass passes share. A new `unjittered_view_proj`
  field is appended to the view uniform (352 → 416 bytes); the motion-vector
  prepass reads it for the current-frame clip position so velocities stay clean.
  `prev_view_proj` is advanced with the unjittered matrix unconditionally, so
  toggling TAA never injects a jitter offset into the next frame's motion
  vectors. When no camera jitters, `view_proj == unjittered_view_proj`. The
  jitter offset is added projection-agnostically (as `offset * clip.w` on
  `clip.x`/`clip.y`), correct for both perspective and orthographic cameras.

- **History is a per-camera two-texture ping-pong** of `rgba16float`. Each frame
  the resolve reads one slot as history and writes the other (no read/write
  hazard); the written slot is published as the scene view and becomes next
  frame's history. The first frame and the frame after a resize re-prime from
  the current scene (a `reset` flag) instead of blending stale or empty history.

- **The resolve reprojects then variance-clips.** History is sampled at
  `uv + (mv.x, -mv.y)` (the motion target's half-NDC delta converts to a UV
  offset by a Y flip). It is then clipped into the current 3×3 neighborhood's
  YCoCg mean+variance color box (rejecting stale/disoccluded history → no
  ghosting), and blended with the current sample using Karis tonemap weighting
  (`1/(1+luma)`) to suppress the firefly trails a naive linear-HDR blend leaves.
  Reprojection landing off-screen falls back to the current sample. All sampling
  uses explicit-LOD `textureSampleLevel` for non-uniform-control-flow safety.

- **A shared `CurrentHdrView` resource replaces per-pass hardcoded lookups.**
  Seeded each frame in `RenderSet.Prepare` to each HDR camera's
  `mainColorTarget`, every HDR post pass reads it as input, renders, and stores
  its own output back; the terminal tonemap pass reads the final entry. The
  graph's topological, single-threaded execution makes the sequential updates
  safe. MotionBlur and Tonemapping were refactored onto it.

- **No new capability flag and no new opaque-pass binding.** The formats already
  exist (ADR-0048/0051). TAA reads depth/motion/scene as sampled textures in its
  own resolve bind group, so the deferred `@group(3)` opaque prepass-read
  binding (`docs/backlog/prepass-readable-binding.md`) is *not* its consumer and
  stays deferred — that backlog item's "first consumer likely TAA" note is
  inaccurate; TAA reads via its own pass, not the opaque forward shader.

## Consequences

- The view uniform grows by one `mat4x4` (352 → 416 bytes) for every camera,
  jittered or not. The motion-vector prepass shader reads `unjittered_view_proj`
  instead of `view_proj` for its current clip position; all other geometry
  shaders are unchanged and pick up jitter for free through `view_proj`.
- Two extra `rgba16float` history textures are allocated per TAA camera
  (proportional to render resolution), freed when the camera stops using TAA or
  leaves the live set.
- `CurrentHdrView` removes the inter-pass coupling ADR-0052 warned about: passes
  no longer name each other's output resources. The cost is one per-frame map
  reseed and one `set` per post pass.
- `depth` is written jittered while the uniform's standalone `projection` /
  `inverse_view` stay unjittered. No shader reconstructs view-space position
  from depth today, but a future SSAO/SSR consumer that does must account for the
  jitter — a documented latent trap, not a current bug.
- `TaaPlugin` is auto-installed by `CorePlugin` after `MotionBlurPlugin` so its
  `finish()` can order the resolve ahead of the blur and tonemap nodes. In scenes
  without a `Taa` camera the extract/prepare systems skip every camera, no jitter
  is applied, and the node never records a pass — the cost is graph edges and
  per-frame map lookups.
- TAA is 3D-only (it needs the motion-vector prepass), like motion blur — no
  Core2d variant.

## Implementation

- `packages/engine/src/taa/taa.ts` — `Taa`, `DEFAULT_TAA`
- `packages/engine/src/taa/halton.ts` — `haltonJitter`, `TAA_JITTER_SAMPLE_COUNT`
- `packages/engine/src/taa/taa.wgsl.ts` — `TAA_WGSL` (`retro_engine::taa`)
- `packages/engine/src/taa/taa-pipeline.ts` — `TaaPipeline`, `TaaKey`
- `packages/engine/src/taa/taa-node.ts` — `makeTaaNode`, `TaaPass3dLabel`
- `packages/engine/src/taa/view-taa.ts` — `ViewTaa`, `TaaParams`
- `packages/engine/src/taa/view-taa-targets.ts` — `ViewTaaTargets`, `TaaCacheEntry`, `TAA_TARGET_FORMAT`, `TAA_PARAMS_BYTE_SIZE`, `resolveTaaTargets`, `evictTaaTargets`
- `packages/engine/src/taa/taa-plugin.ts` — `TaaPlugin` (extract + prepare systems, graph wiring)
- `packages/engine/src/camera/jitter.ts` — `ViewJitter`, `JitterOffset`, `jitterProjection`
- `packages/engine/src/camera/current-hdr-view.ts` — `CurrentHdrView`
- `packages/engine/src/camera/extracted.ts` — `unjittered_view_proj` in `VIEW_UNIFORM_WGSL`; `VIEW_UNIFORM_BYTE_SIZE` (416)
- `packages/engine/src/camera/camera-plugin.ts` — bakes jitter into `view_proj`, writes `unjittered_view_proj`, seeds `CurrentHdrView`
- `packages/engine/src/material/pbr.wgsl.ts` — `vs_prepass` reads `unjittered_view_proj` for the motion-vector current clip
- `packages/engine/src/motion-blur/motion-blur-node.ts`, `packages/engine/src/tonemapping/tonemapping-node.ts` — read/write `CurrentHdrView` instead of hardcoded lookups
- `packages/engine/src/core-plugin.ts` — auto-installs `TaaPlugin` after `MotionBlurPlugin`
- `packages/engine/src/index.ts` — re-exports the public surface above
- `packages/engine/bench/taa.bench.ts` — per-frame dispatch cost, TAA on vs off
- `apps/playground/src/taa-showcase-plugin.ts` — `?mode=taa` device-verification harness
