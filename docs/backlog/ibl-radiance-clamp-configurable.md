# Make the IBL prefilter radiance clamp configurable

- **Created:** 2026-06-27

## Context

`environment.wgsl` clamps every sampled source-radiance value to a hardcoded
`MAX_RADIANCE = 50.0` before accumulating it in the diffuse irradiance
convolution and the specular GGX prefilter. The clamp exists to keep the bake
finite and smooth: real HDR skies carry `+inf` / tens-of-thousands sun pixels
that otherwise propagate into the baked maps as `inf` (white patches), `inf*0 =
NaN` (black patches, and frame-wide smears once that `NaN` reaches the TAA
history), and undersampled-sun firefly speckle. See the commit that introduced
the clamp (`fix(engine): clamp HDR radiance during IBL prefilter`).

`50.0` is a single global compromise. It is low enough to keep diffuse smooth but
also caps the brightest specular reflections, so a very smooth / near-mirror
surface loses some sun punch. Different scenes (a dim interior vs. a blown-out
desert noon) want different caps. This work exposes the cap as authored state
instead of a constant.

Likely shape: add a `radianceClamp` (or `maxRadiance`) field to
`EnvironmentMapLight` (`packages/engine/src/environment/environment-map-light.ts`),
default `50`, thread it into `EnvironmentPrefilter` / `RenderEnvironmentMaps` as a
bake parameter (uniform fed to `fs_irradiance` / `fs_prefilter`, replacing the
WGSL `const`), and register it in the component's reflection schema (CLAUDE.md
§13) so it round-trips in saved scenes.

## Why deferred

- The hardcoded `50.0` already fixes the visible artifacts; this is a quality /
  art-direction refinement, not a correctness gap.
- Real design wrinkle to resolve first: the prefilter cache in
  `RenderEnvironmentMaps` is keyed by the source image's `AssetIndex` only. A
  per-light clamp makes the baked output depend on the clamp value too, so the
  cache key must include the clamp (or two cameras sharing one env image but
  using different clamps would collide). Alternatively the clamp could live as a
  single render-world setting (e.g. on a settings resource) rather than
  per-light — decide which before implementing. Worth an ADR if it lands as a
  new bake-cache key contract.

## Acceptance

- `EnvironmentMapLight` (or an agreed settings resource) exposes the radiance
  clamp as authored, reflected, scene-serialized state with a sensible default.
- Changing the clamp re-bakes (or selects a correctly-keyed cached bake) so two
  environments with different clamps don't collide, and the change is visible at
  runtime.
- Raising the clamp restores brighter sun reflections on low-roughness surfaces;
  lowering it suppresses fireflies on an extreme HDR — both verified visually in
  the studio against `sky.hdr`.
- No `inf` / `NaN` can re-enter the baked maps regardless of the chosen value
  (the cap stays finite; the existing guarantees hold).
