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

**Remaining:** bake `.meta` settings into the packed manifest entry for the
bundle/web path (so a baked build carries per-asset settings without a loose
sidecar).

## Phase 3 — mipmaps, max size, PPU

- **Mipmaps + trilinear** — generate mip chain on upload; `Image` currently
  supports `mipLevelCount: 1` only, so this needs the upload path to build mips.
- **Max size** — downscale on import to a cap.
- **PPU** (pixels-per-unit) — a sprite-sizing setting; consumed by
  `Sprite` / the sprite definitions work rather than the sampler.
