---
'@retro-engine/engine': minor
'@retro-engine/renderer-core': minor
---

feat(engine): screen-space ambient occlusion (GTAO) — ADR-0054

Per ADR-0054, adds a per-camera `ScreenSpaceAo` component and a pre-opaque ambient-occlusion pass that reads the depth + normal prepass, estimates occlusion with a horizon search, denoises it, and feeds the result back into the lit forward shader's ambient term. AO darkens only the ambient/indirect lighting in creases and contact points — it is not a post-process over the final image, which would wrongly darken direct light.

The pass chain is `Prepass → AO GTAO → AO blur → AO temporal → Opaque`:

- **GTAO**, fragment-only (no compute/storage dependency → WebGL2-reachable; a compute speedup is deferred behind a capability flag). Depth + normal are read with `textureLoad` (no sampler), sidestepping depth-format filterability and sampling-uniformity hazards.
- **Exact reconstruction under TAA jitter.** View-space position is reconstructed by inverting the *jittered* projection (the matrix the depth was actually rasterized with), computed per AO-enabled camera on the CPU and uploaded in the AO params buffer — the shared view uniform is untouched, so non-AO cameras pay nothing. Resolves the latent reconstruction trap ADR-0053 flagged.
- **Denoise:** a depth/normal-aware bilateral blur, plus motion-vector-reprojected temporal accumulation (a per-camera history ping-pong with disocclusion rejection) when a `MotionVectorPrepass` is present; otherwise blur-only.
- **Forward feedback** through a new opaque `@group(3)` AO read binding: lit materials that declare `static usesAo` fork an `aoEnabled` pipeline variant (`#ifdef ENABLE_SSAO`) whose `fs_main` multiplies the sampled occlusion into the ambient term. `OpaquePass3dNode` binds the AO texture for the whole pass; pipelines that don't declare the group ignore it (same contract as the `@group(2)` lights binding). The pipeline key carries a stable `aoEnabled` boolean. This lands the previously deferred opaque `@group(3)` prepass-read binding — carrying the derived AO texture rather than raw prepass channels.

**New public surface:**

- `ScreenSpaceAo`, `DEFAULT_AO` — per-camera component (radius, intensity, bias, slices, steps).
- `AoPlugin` — auto-installed by `CorePlugin`; warns-once-and-skips a camera lacking `DepthPrepass` + `NormalPrepass`.
- `AoPipeline`, `AoBlurPipeline`, `AoTemporalPipeline`, `AoBindGroupCache`, `ViewAo`, `ViewAoTargets`, the AO nodes/labels, and the `AO_*_WGSL` modules.
- `MaterialPipelineKey.aoEnabled`, `MaterialCtor.usesAo` (set on `StandardMaterial`).
- `AO_TARGET_FORMAT` (`r8unorm`), `AO_HISTORY_FORMAT` (`rg16float`), `AO_PARAMS_BYTE_SIZE`.

**Behaviour changes:**

- The engine-managed `view-depth` texture is now allocated `RENDER_ATTACHMENT | TEXTURE_BINDING` (was attachment-only) so screen-space passes can sample it. Additive — the depth attachment usage is unchanged.
- `@retro-engine/renderer-core` `TextureFormat` gains `r8unorm` (single-channel AO target). WebGPU passes it through natively; `bytesPerTexel` returns 1.
- AO is 3D-only and opt-in; cameras without `ScreenSpaceAo`, and unlit/transparent materials, are unaffected (the non-AO pipeline variant is byte-identical).

Browser-verified in `apps/playground` (`?mode=ao`, press O to toggle; `&taa=1` to check stability under jitter).
