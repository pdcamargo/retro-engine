# ADR-0166: Texture import settings

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

`Image` already carries a `SamplerDescriptor` (filter / wrap) and an
`ImageColorSpace`, but the PNG/JPEG/WebP importer hard-coded a linear-filtered,
sRGB color image. Two real needs were unmet:

- **Pixel-art** wants **nearest** filtering across the board; bilinear blurs the
  art. This is a project-wide default, not a per-file choice.
- **Data maps** (normal / metallic-roughness / occlusion) are `linear`, not sRGB,
  and that cannot be inferred from the file — a normal map is a `.png` like any
  other. It must be *authored*.

The roadmap flags this "high-value + cheap — required for crisp pixel-art." The
open questions: what the settings are, and where they come from (a project-wide
default vs. a per-asset `.meta` sidecar).

## Decision

Introduce a **`TextureImportSettings` data model** + pure resolvers, and thread
**project-wide defaults** through the importer now; per-asset `.meta` overrides
are a tracked follow-up.

- **`TextureImportSettings`** — a plain, serializable shape: `filter`
  (`'nearest' | 'linear'`, default linear), `wrap` (`'repeat' | 'clamp' |
  'mirror'`, default clamp), `colorSpace` (`'srgb' | 'linear'`, default srgb).
  Data, not a live sampler, so it round-trips and a future `.meta` file *is* this
  object.
- **Pure resolvers** — `resolveTextureSampler(settings) → SamplerDescriptor`
  (filter → min/mag, wrap → both address modes) and
  `resolveTextureColorSpace(settings)`. `imageFromDecoded(decoded, settings)`
  builds the `Image`. All pure and unit-tested — no ECS, no GPU.
- **Importer default.** `createImageImporter(decode, settings?)` applies
  `settings` as the default for **every** image it produces. A pixel-art project
  registers the loader with `{ filter: 'nearest' }`; a data-map extension
  registers a second importer with `{ colorSpace: 'linear' }`. Backward
  compatible — omitted settings reproduce the previous linear/sRGB behavior.
- **Per-asset `.meta` is deferred.** True per-file settings (a `wood.png.meta`
  overriding one texture) need the settings to reach the importer through the
  asset server's `LoadContext` — an assets-pipeline change (a `.meta` parse +
  `LoadContext.settings`) that is its own slice. The model here is exactly what
  that slice will carry, so it is the foundation, not throwaway.

`filter` maps only min/mag; **trilinear** (smoothing across mip levels) and
`maxSize` / PPU need mip generation / resize the `Image` upload does not do yet,
so they are out of this slice.

## Consequences

- A project gets crisp pixel-art with one importer registration
  (`{ filter: 'nearest' }`) — the headline value — and correct data-map loading
  with an explicit `{ colorSpace: 'linear' }` importer.
- The pure resolvers are the single place settings become a sampler, reused by
  the loose-file importer today and the `.meta`-driven path later.
- Sprite definitions (ADR-0126 / roadmap) and per-asset overrides build on this
  `TextureImportSettings` shape.
- **Deferred:** per-asset `.meta` sidecar + `LoadContext.settings`; mipmaps /
  trilinear; `maxSize` downscale; PPU (a sprite concern).

## Implementation

- `packages/engine/src/image/texture-import-settings.ts` — the type + pure
  `resolveTextureSampler` / `resolveTextureColorSpace`.
- `packages/engine/src/image/image-importer.ts` — `imageFromDecoded`;
  `createImageImporter` takes default `settings`.
