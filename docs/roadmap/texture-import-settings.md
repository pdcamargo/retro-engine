# Texture import settings

Per-texture import controls (filter / wrap / color space / mipmaps / max size /
PPU), consumed when building an `Image`. Promoted from the P1 "Texture import
settings (`.meta`)" roadmap item (flagged high-value for crisp pixel-art).

## Phase 1 — model + resolvers + importer default ✅ (ADR-0166)

`TextureImportSettings` (`filter`/`wrap`/`colorSpace`) + pure
`resolveTextureSampler` / `resolveTextureColorSpace` + `imageFromDecoded`.
`createImageImporter(decode, settings?)` applies settings as the project-wide
default for every image (pixel-art → `{ filter: 'nearest' }`; data maps →
`{ colorSpace: 'linear' }`). Unit-tested; backward compatible.

## Phase 2 — per-asset `.meta` overrides ✅ (ADR-0166)

A `<name>.meta` sidecar (UTF-8 JSON of `TextureImportSettings`) overrides the
importer default for one texture. Implemented **importer-local**: the image
importer reads its own sibling `.meta` through the `LoadContext.read` it is handed
(`parseTextureMeta` keeps only valid fields; a missing/malformed sidecar is
silently ignored) and merges it over the default. No asset-server or
`LoadContext`-shape change — lower risk than pre-threading a settings field. Pure
parser + sibling-path + importer tests.

## Phase 2b — bake `.meta` into the export manifest ✅ (ADR-0172)

`AssetManifestEntry` gained an optional `meta` field (the sidecar's fields beyond
`version`/`guid`/`kind`); the build scan (`parseMetaEntry`) bakes it, and
`RpakAssetSource` synthesizes the `<name>.meta` read from it — so an exported game
applies per-asset settings without shipping the loose sidecar, and the engine
importer (which reads `ctx.read('<name>.meta')`) is unchanged. Generic across any
sidecar-reading importer; assets without settings stay `meta`-less. Unit-tested +
export sanity-checked.

## Phase 3 — mipmaps, max size, PPU

- **Mipmaps + trilinear** — generate mip chain on upload; `Image` currently
  supports `mipLevelCount: 1` only, so this needs the upload path to build mips.
- **Max size** — downscale on import to a cap.
- **PPU** (pixels-per-unit) — a sprite-sizing setting; consumed by
  `Sprite` / the sprite definitions work rather than the sampler.
