---
'@retro-engine/engine': minor
---

feat(engine): `.hdr` HDRI import + equirectangular→cube conversion

Per ADR-0106, completes roadmap Phase 10.7: an equirectangular Radiance `.hdr`
can now be the source for both image-based lighting and the skybox (ADR-0105
shipped those from a cube source). Decoder unit-tested; the equirect→cube path
device-verified in `apps/playground` (`?mode=ibl&src=equirect`).

**New public surface:**

- `decodeRadianceHdr(bytes)` — pure Radiance RGBE decoder (new-style adaptive
  RLE + flat scanlines, `-Y h +X w` orientation) → linear float RGBA
  (`DecodedHdr`).
- `createHdrImporter()` — `AssetImporter<Image>` decoding `.hdr` bytes into a
  linear `rgba16float` equirectangular (2D) `Image`. Register it with an
  `AssetServer` for the `'hdr'` extension (the studio's project loader does).
- `decodeRadianceHdrPreview(bytes, maxDim)` / `HdrPreview` — a downsampled,
  Reinhard-tonemapped, sRGB-encoded RGBA8 preview of an HDR, for asset-browser
  thumbnails (does not materialize the full float buffer).
- `EnvironmentCubeConverter`, `RenderEnvironmentCubes`,
  `ensureEnvironmentCubeResources`, `resolveEnvironmentCubeView`,
  `ResolvedEnvironmentCube`, `EQUIRECT_TO_CUBE_WGSL` — shared on-demand
  equirectangular→cube conversion (six GPU render passes, cached by source).

**Behaviour changes:**

- `RenderImage` gained a `dimension` field so the skybox / environment systems
  can distinguish an equirectangular (`'2d'`) source from a `'cube'` one and
  convert the former. Any code constructing a `RenderImage` literal must now set
  `dimension`.
- `Skybox` and `EnvironmentMapLight` accept either a cube or an equirectangular
  `Image` handle; equirectangular sources are converted to a cube once and
  cached (the derived cube is runtime-only, never serialized).
