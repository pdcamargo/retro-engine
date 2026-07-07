---
'@retro-engine/engine': minor
---

feat(engine): texture import settings (filter / wrap / color space)

Phase 1 of texture import settings (ADR-0166). A `TextureImportSettings` shape
(`filter` nearest/linear, `wrap` repeat/clamp/mirror, `colorSpace` srgb/linear)
plus pure `resolveTextureSampler` / `resolveTextureColorSpace` and an
`imageFromDecoded` builder. `createImageImporter(decode, settings?)` now applies
settings as the project-wide default for every image it produces:

```ts
server.registerLoader('png', images, createImageImporter(decode, { filter: 'nearest' })); // crisp pixel-art
server.registerLoader('png', normalMaps, createImageImporter(decode, { colorSpace: 'linear' })); // data map
```

Backward compatible — omitted settings reproduce the previous linear-filtered sRGB
color image. Per-asset `.meta` overrides (via the asset server's `LoadContext`)
and mipmaps / max-size / PPU are tracked follow-ups.
