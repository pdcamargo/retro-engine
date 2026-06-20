# ADR-0106: HDRI (`.hdr`) import and equirectangular→cube conversion

- **Status:** Accepted
- **Date:** 2026-06-20

## Context

ADR-0105 shipped the skybox + IBL from a **cube** `Image` and explicitly left
loading equirectangular `.hdr` HDRIs — the standard authoring format for
environment maps — as a later decision. Photographed / Poly Haven-style
environments ship as equirectangular Radiance `.hdr` (or `.exr`) files, not as
six cube faces, so without an importer the environment system could only consume
hand-built cubes.

Two integration questions had to be answered: how a 2D equirectangular image
reaches the cube-only skybox and IBL prefilter, and where the `.hdr` decoder
lives given the engine has no default image-file loader (loaders are registered
by the consuming app, e.g. the studio's project loader).

## Decision

- A pure **Radiance RGBE decoder** (`decodeRadianceHdr`) handles the new-style
  adaptive-RLE and flat scanline encodings and the standard `-Y h +X w`
  orientation, producing linear float RGBA. `createHdrImporter()` wraps it into
  an `AssetImporter<Image>` that yields a linear `rgba16float` equirectangular
  (2D) `Image` (float32 is packed to float16 in TS, since the HAL has no
  float32-filterable path requirement here).
- Equirectangular sources are converted to a **cube once, on demand, on the
  GPU** (six fullscreen render passes), cached by source `AssetIndex`. The cube
  is the single internal representation; the skybox and the IBL prefilter both
  call `resolveEnvironmentCubeView`, which passes cube sources through unchanged
  and converts 2D sources. `RenderImage` now carries its source `dimension` so
  consumers can tell the two apart. The conversion resources are shared and
  ensured by both `SkyboxPlugin` and `EnvironmentMapPlugin`, so a skybox works
  with an `.hdr` even without the environment plugin.
- The `.hdr` loader is **registered by the consumer**, matching the existing
  loader-registration pattern (`.rmesh`, `.gltf`). The studio's project loader
  registers `'hdr'` against the `Images` store; `createHdrImporter` is exported
  for any other host.

## Consequences

- "One HDRI, two consumers" now holds for real `.hdr` files: a single
  `Handle<Image>` to an equirectangular HDRI feeds both the skybox and IBL via
  one cached cube conversion.
- The derived cube (like the prefiltered maps) is runtime-only and never
  serialized — only the authored `.hdr` handle is.
- The converted cube is a fixed 1024²-per-face `rgba16float` (≈50 MB per source);
  a resolution policy keyed to the source dimensions is a later refinement.
- `.exr` (OpenEXR) is **not** included — it pulls a much heavier decoder; `.hdr`
  Radiance covers the common HDRI case. `.exr` is deferred.
- The RGBE decoder is CPU-side and single-threaded; a very large HDRI decodes in
  one pass on load. Acceptable for a one-time load; a worker offload is possible
  later without changing the interface.

## Implementation

- `packages/engine/src/image/hdr.ts` — `decodeRadianceHdr`, `createHdrImporter`,
  `DecodedHdr`, plus `decodeRadianceHdrPreview` / `HdrPreview` (a downsampled,
  Reinhard-tonemapped, sRGB-encoded LDR preview for asset thumbnails; never
  materializes the full float buffer).
- `packages/engine/src/image/render-image.ts` — `RenderImage.dimension`.
- `packages/engine/src/environment/equirect-to-cube.wgsl.ts` — `EQUIRECT_TO_CUBE_WGSL`.
- `packages/engine/src/environment/environment-cube.ts` — `EnvironmentCubeConverter`,
  `RenderEnvironmentCubes`, `ensureEnvironmentCubeResources`,
  `resolveEnvironmentCubeView`, `ResolvedEnvironmentCube`.
- `packages/engine/src/skybox/skybox-node.ts`,
  `packages/engine/src/environment/environment-plugin.ts` — resolve the source to
  a cube before sampling / prefiltering.
- `apps/studio/src/project/project-scene.ts` — registers the `'hdr'` loader.
- `apps/studio/src/thumbnails/thumbnail-service.ts`,
  `apps/studio/src/project/{watch-router,project-browser}.ts` — `.hdr` is a
  recognized, previewable browser asset (decode + tonemap to an LDR thumbnail).
- `apps/studio/src/scene-bootstrap.ts`, `apps/studio/src/showcase-scene.ts` —
  register `SkyboxPlugin` + `EnvironmentMapPlugin` and put a `Skybox` +
  `EnvironmentMapLight` on the showcase Main Camera (gradient sky cube).
