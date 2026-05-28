# `tony_mc_mapface` tonemapping operator

- **Created:** 2026-05-28

## Context

Roadmap §12.2 lists `tony_mc_mapface` as one of the operators a `Tonemapping`
camera component should expose. ADR-0048 (Phase 12.1/12.2) shipped the
post-processing chain — `Camera.hdr = true`, the per-camera HDR intermediate,
the `Tonemapping` component, the render node, and seven pure-math operators
(`none`, `reinhard`, `reinhard_luminance`, `aces_fitted`, `agx`,
`blender_filmic`, `somewhat_boring_display_transform`). Tony McMapface is the
one operator from the roadmap list that ADR-0048 deliberately leaves out
because it is **LUT-driven**: Tomasz Stachowiak's reference implementation
sampled by Bevy uses a 48×48×48 `Rgba16Float` cubic LUT (≈440 KiB) shipped as
a `.ktx2` texture asset. Without a texture-loading asset system in the engine,
there is no clean way to ship the LUT — embedding ≈440 KiB of base64 into the
engine bundle is dead weight that becomes obsolete the moment assets land.

## Why deferred

- The asset system has not landed yet — see `docs/roadmap/asset-system.md`. It
  is the prerequisite for both HDR texture loading (`.ktx2` / `.exr` / `.hdr`)
  and the 3D-texture / sampler binding the tonemap pipeline would need for the
  cubic LUT.
- ADR-0048 ships `agx` as the default precisely because it is the best-looking
  LUT-free operator; users who want Tony today have a forgiving alternative
  already in the union.
- Bevy's Tony McMapface implementation is a small, well-documented WGSL
  sample-and-extrapolate snippet — once the asset system can deliver the LUT,
  adding the operator is a small change confined to
  `packages/engine/src/tonemapping/`. It is sequencing, not difficulty.

## Acceptance

- The asset system can load a 48³ `Rgba16Float` 3D texture (or the LUT is
  shipped through whatever cubical-LUT primitive the asset system settles on).
- `TonemappingMethod` gains `'tony_mc_mapface'`; `TonemappingPipeline` learns
  how to bind the LUT + 3D-texture sampler when that operator is selected (one
  extra bind-group entry behind a method-conditional layout, or a second
  pipeline-layout variant — design decision belongs in the implementing ADR).
- A new fragment entry point `fs_tony_mc_mapface` ships in
  `packages/engine/src/tonemapping/tonemapping.wgsl.ts`.
- Visible in `apps/playground` (`?hdr=1&tm=tony_mc_mapface`) and unit-tested
  against ADR-0048's existing tonemap-plugin test for graph wiring + pipeline
  cache disambiguation.
- This backlog file is deleted by the user.
