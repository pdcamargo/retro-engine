# ADR-0105: Skybox and image-based lighting from a cube environment

- **Status:** Accepted
- **Date:** 2026-06-20

## Context

The renderer had analytic 3D lights, shadows, PBR, and HDR + tonemapping, but no
environment lighting: the PBR ambient term was a flat constant (`lights.ambient`)
and there was no sky behind the scene. Objects read as floating in a void and
reflected nothing. The renderer roadmap planned this as two consumers of one
asset — a visible **skybox** (Phase 12.7) and **image-based lighting (IBL)**
(Phase 10.7) — modelled on Bevy's `Skybox` + `EnvironmentMapLight`.

Two cross-cutting constraints shaped the design: every authored component must
declare reflection/serialization (CLAUDE.md §13), and the renderer is
WebGL2-reachable, so optional capabilities are gated and compute is avoided where
a render-pass formulation exists. The HAL exposes no compute pipeline; it does
expose render-to-individual-cubemap-face/mip views (`TextureViewDescriptor`
`baseArrayLayer` / `baseMipLevel`).

This ADR covers the cube-sourced skybox + IBL. Loading equirectangular `.hdr`
HDRIs and converting them to cubes is a separate, later decision.

## Decision

- **Skybox** is a per-camera `Skybox` component (`image: Handle<Image>` cube,
  `brightness`, `rotation`) drawn by a fullscreen-triangle `ViewNode` inserted
  into Core3d **between the opaque and transparent passes**. It is depth-tested
  (`less-equal`, no depth write) against the scene so opaque geometry occludes
  it, reconstructs the per-pixel world ray from the projection focal terms +
  `inverse_view`, and writes HDR into the camera's main color target so it
  tonemaps with the frame. The fragment shader is resolved via a registered
  module name (`SkyboxPlugin({ shaderModule })`), so a gradient/procedural sky is
  a drop-in replacement without forking.
- **IBL** is a per-camera `EnvironmentMapLight` component prefiltered at runtime
  into a diffuse irradiance cube + a roughness-mipped specular cube + a BRDF
  integration LUT, via **render passes** (no compute), one submission per cube
  face/mip. The split-sum result replaces the flat ambient term in `pbr.wgsl`.
  The derived prefilter maps are runtime-only and **never serialized** — only the
  authored `Handle<Image>` is.
- **IBL is folded into the existing `GpuLights` `@group(2)` bind group** rather
  than a new bind group + `usesIbl` material marker. `@group(2)` is the only
  view-level group unconditionally present for every lit material (AO's
  `@group(3)` is conditional, which would force a binding-index gap), and IBL
  literally replaces the `lights.ambient` term that already lives there. The env
  set is bindings 3–7 (irradiance cube, specular cube, BRDF LUT, sampler, params
  uniform), always bound — 1×1 fallbacks + a `has_environment` flag select the
  flat-ambient path when no environment is active. The `GpuLights` *uniform*
  byte layout is unchanged; env params live in their own binding-7 uniform.

## Consequences

- One authored `Handle<Image>` can feed both a `Skybox` and an
  `EnvironmentMapLight` — one asset, two consumers, as planned.
- Every lit material gets environment lighting automatically when an
  `EnvironmentMapLight` is active; there is **no per-material opt-out**. This is
  the accepted trade-off for not threading a `usesIbl` specialization variant +
  empty-layout placeholders through the shared `MaterialPlugin`.
- The IBL prefilter is render-pass based and WebGL2-reachable; no compute or
  storage-texture capability is taken on. Specular prefilter samples the source
  cube at mip 0 (the `Image` asset is single-mip), so very rough reflections of a
  high-frequency HDRI may show mild fireflies — acceptable for the first
  implementation; source mip pre-blur is a later refinement.
- The environment plugin depends on `GpuLights` (intra-package, one-directional:
  light3d does not depend on environment).
- Both passes were device-verified in `apps/playground` (`?mode=skybox`,
  `?mode=ibl`): sky occlusion + rotation; roughness-swept reflections + diffuse
  irradiance tint.

## Implementation

- `packages/engine/src/skybox/` — `Skybox`, `SkyboxPlugin`, `makeSkyboxNode` /
  `SkyboxPass3dLabel`, `SkyboxPipeline`, `ViewSkybox`, `SKYBOX_WGSL`.
- `packages/engine/src/environment/` — `EnvironmentMapLight`,
  `EnvironmentMapPlugin`, `EnvironmentPrefilter`, `RenderEnvironmentMaps`,
  `ActiveEnvironment`, `ENVIRONMENT_PREFILTER_WGSL`.
- `packages/engine/src/light3d/gpu-lights.ts` — `GpuLights` `@group(2)` bindings
  3–7, `setEnvironmentTextures`, `writeEnvironmentParams`,
  `ENVIRONMENT_PARAMS_BYTE_SIZE`.
- `packages/engine/src/light3d/light-3d.wgsl.ts` — env bindings, `EnvironmentParams`,
  `has_environment`, `fresnel_schlick_roughness`, `evaluate_ibl`.
- `packages/engine/src/material/pbr.wgsl.ts` — IBL-vs-flat-ambient branch in `fs_main`.
