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

## Phase 2 — per-asset `.meta` overrides

A `<file>.meta` sidecar carrying `TextureImportSettings`, parsed by the asset
server and threaded to the importer via `LoadContext` (a new `settings` field),
so one texture can override the project default. This is the assets-pipeline
half: `.meta` schema + parse + `LoadContext.settings` + the importer reading it.
Ties into the manifest (bake settings into the packed manifest entry).

## Phase 3 — mipmaps, max size, PPU

- **Mipmaps + trilinear** — generate mip chain on upload; `Image` currently
  supports `mipLevelCount: 1` only, so this needs the upload path to build mips.
- **Max size** — downscale on import to a cap.
- **PPU** (pixels-per-unit) — a sprite-sizing setting; consumed by
  `Sprite` / the sprite definitions work rather than the sampler.
