# ADR-0052: screen-space motion blur — HDR-space pass consuming the motion-vector prepass

- **Status:** Accepted
- **Date:** 2026-05-30

## Context

Phase 12.10. Motion blur is the first real consumer of the screen-space
motion-vector prepass ([ADR-0050](ADR-0050-screen-space-prepass-family.md) /
[ADR-0051](ADR-0051-screen-space-motion-vectors.md)). Bringing it up surfaced
that the motion-vector prepass had never run on a real WebGPU device — only
against the permissive test stub — and carried two device-fatal defects (the
previous-instance vertex attributes sat above the 16-attribute limit; the
prepass fragment-target gate keyed on a class name that minification erases).
Those were fixed and the prepass was device-verified before this pass was
built; the fixes are recorded in `docs/bugs/`.

Two HAL constraints shape the design. The `renderer-core` HAL has no
texture-to-texture copy / blit — the only GPU→GPU path is rendering a
fullscreen triangle that samples an input texture. And the swapchain texture is
presentation-only: it is not sampleable. So any pass that must *read* the
rendered scene has to read a sampleable intermediate, which exists only when
`Camera.hdr = true` (the per-camera `rgba16float` intermediate the geometry
passes write, that the tonemap pass already reads). Motion blur reads the lit
scene, so it is necessarily an HDR-space pass that runs before tonemapping —
running it "after tonemapping on the swapchain" is impossible.

## Decision

Add a per-camera `MotionBlur` component and an HDR-space full-screen pass that
runs between the transparent pass and tonemapping. The pass samples the
camera's HDR scene intermediate (`mainColorTarget`) along the per-pixel
velocity read from the `rg16float` motion-vector target, averaging N taps
across the shutter-open interval, and writes the result into a **second**
per-camera `rgba16float` intermediate. The tonemap node is redirected to read
that intermediate when it exists, falling back to `mainColorTarget` otherwise.

- **Prerequisites.** The pass requires both `Camera.hdr = true` (a sampleable
  scene intermediate exists) and a `MotionVectorPrepass` on the camera (a
  motion target exists). When either is missing the prepare system allocates
  nothing and warns once; the node short-circuits and tonemapping falls back to
  the raw HDR target — the camera renders un-blurred rather than failing.
- **Graph ordering.** Edges `Transparent → MotionBlur → Tonemapping` force the
  blur to run on the composited scene and the tonemap to consume its output.
  The pre-existing `Transparent → Tonemapping` edge becomes redundant but
  harmless.
- **Velocity math.** The motion target stores the half-NDC delta from
  `compute_motion_vector`. Converting to a UV displacement is an axis flip on Y
  (the half-NDC `0.5` and the NDC→UV `2×` cancel). The shader scales by
  `intensity × shutterAngle`, clamps to `maxVelocity`, early-outs on
  near-static pixels, and clamps the tap count to `[1, 32]`. Explicit-LOD
  sampling (`textureSampleLevel`) is used throughout so the early-out's
  non-uniform control flow is valid.
- **No new capability flag.** `rg16float` (ADR-0051) and the `rgba16float`
  render-attachment+sampled intermediate (ADR-0048) already exist; the output
  intermediate reuses the HDR format and usage, so any HDR-capable device
  already supports it.

A single read-many/write-once pass writes a distinct output texture, so no
ping-pong is needed.

## Consequences

- A second per-camera `rgba16float` intermediate is allocated for cameras that
  blur — extra memory proportional to render resolution, freed when the camera
  stops blurring or leaves the live set.
- The tonemap node gains a soft, optional dependency on the motion-blur output
  resource: it looks the resource up and falls back when absent. Its
  identity-keyed bind-group cache rebuilds for free when the input view flips
  between the HDR target and the blur output (e.g. toggling blur at runtime).
  The tonemap *pipeline* is untouched.
- `MotionBlurPlugin` is auto-installed by `CorePlugin` after `TonemappingPlugin`
  so its `finish()` can order the tonemap node behind the blur, and so the pass
  is available out of the box for a correctly-configured camera. In scenes that
  do not blur, the extract/prepare systems skip every camera and the node never
  records a pass — the cost is one graph edge and per-frame map lookups.
- Motion blur is 3D-only: there is no 2D motion target, so unlike tonemapping
  there is no Core2d variant.

## Implementation

- `packages/engine/src/motion-blur/motion-blur.ts` — `MotionBlur`, `DEFAULT_MOTION_BLUR`
- `packages/engine/src/motion-blur/motion-blur.wgsl.ts` — `MOTION_BLUR_WGSL` (`retro_engine::motion_blur`)
- `packages/engine/src/motion-blur/motion-blur-pipeline.ts` — `MotionBlurPipeline`, `MotionBlurKey`
- `packages/engine/src/motion-blur/motion-blur-node.ts` — `makeMotionBlurNode`, `MotionBlurPass3dLabel`
- `packages/engine/src/motion-blur/view-motion-blur.ts` — `ViewMotionBlur`, `MotionBlurParams`
- `packages/engine/src/motion-blur/view-motion-blur-targets.ts` — `ViewMotionBlurTargets`, `MotionBlurCacheEntry`, `MOTION_BLUR_TARGET_FORMAT`, `MOTION_BLUR_PARAMS_BYTE_SIZE`, `resolveMotionBlurTarget`, `evictMotionBlurTarget`
- `packages/engine/src/motion-blur/motion-blur-plugin.ts` — `MotionBlurPlugin` (extract + prepare systems, graph wiring)
- `packages/engine/src/tonemapping/tonemapping-node.ts` — reads `ViewMotionBlurTargets` output in place of `mainColorTarget` when present
- `packages/engine/src/core-plugin.ts` — auto-installs `MotionBlurPlugin` after `TonemappingPlugin`
- `packages/engine/src/index.ts` — re-exports the public surface above
- `packages/engine/bench/motion-blur.bench.ts` — per-frame dispatch cost, motion blur on vs off
