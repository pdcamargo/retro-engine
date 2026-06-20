---
'@retro-engine/engine': minor
---

feat(engine): skybox + image-based lighting from a cube environment

Per ADR-0105, lands the cube-sourced half of the environment-map system — a
visible **skybox** (roadmap Phase 12.7) and **image-based lighting** (Phase 10.7)
that share one `Handle<Image>`. The flat ambient term from ADR-0044 is replaced
by environment lighting whenever an `EnvironmentMapLight` is active. Both are
device-verified in `apps/playground` (`?mode=skybox`, `?mode=ibl`). No new HAL,
no new capability flag — the IBL prefilter is render-pass based (WebGL2-reachable),
not compute.

**New public surface:**

- `Skybox` — per-camera component (`image: Handle<Image>` cube, `brightness`,
  `rotation`). Serialized.
- `SkyboxPlugin({ shaderModule? })` — opt-in; inserts a fullscreen-triangle
  `ViewNode` into Core3d between the opaque and transparent passes, depth-tested
  so geometry occludes the sky, writing HDR into the camera's main target. The
  fragment shader is resolved by registered module name, so a custom/procedural
  sky is a drop-in replacement.
- `SkyboxPipeline`, `ViewSkybox`, `makeSkyboxNode` / `SkyboxPass3dLabel`,
  `SKYBOX_WGSL`.
- `EnvironmentMapLight` — per-camera component (`environmentMap: Handle<Image>`
  cube, `intensity`, `diffuseIntensity`, `specularIntensity`, `rotation`).
  Serialized.
- `EnvironmentMapPlugin` — opt-in; requires `Light3dPlugin`. Runtime-prefilters
  the source cube (diffuse irradiance + GGX specular mip chain; the BRDF LUT is
  baked once globally) and feeds the split-sum result into the PBR ambient term.
- `EnvironmentPrefilter`, `RenderEnvironmentMaps`, `ActiveEnvironment`,
  `ENVIRONMENT_PREFILTER_WGSL`, `PrefilteredEnvironment`.
- `ENVIRONMENT_PARAMS_BYTE_SIZE` / `ENVIRONMENT_PARAMS_FLOAT_COUNT`.

**Behaviour changes:**

- The `GpuLights` `@group(2)` bind group grew from 3 bindings to 8: the existing
  lights uniform + shadow atlas + comparison sampler, plus the IBL set —
  irradiance cube (3), specular cube (4), BRDF LUT (5), environment sampler (6),
  and an environment-params uniform (7). The set is always bound (1×1 fallbacks +
  a `has_environment` flag), so lit pipelines pick it up transparently and take
  the flat-ambient path when no environment is active. The `GpuLights` *uniform*
  byte layout is unchanged (8128 B).
- `pbr.wgsl` `fs_main` branches its indirect term: split-sum IBL when an
  environment is bound, otherwise the previous flat `lights.ambient`. Every lit
  material gets IBL automatically — there is no per-material opt-out.

HDRI (`.hdr`) loading + equirectangular→cube conversion (so a `.hdr` can be the
source) is the remaining Phase 10.7 work and lands separately.
