# ADR-0172: Bake `.meta` import settings into the export manifest

- **Status:** Accepted
- **Date:** 2026-07-07
- **Extends:** ADR-0111 (static asset scan), ADR-0151/0153 (web export + `.rpak`), ADR-0166 (texture import settings) — sealed

## Context

ADR-0166 shipped per-asset import settings via a `<name>.meta` sidecar: the image
importer reads `ctx.read('<name>.meta')` and merges its `filter` / `wrap` /
`colorSpace` over the project default. That works for **loose files** (the sidecar
is on disk). But the web export packs only the asset bytes into the `.rpak`
(keyed by GUID) plus a GUID→location `manifest.json` — the `.meta` sidecars are
**not** packed. So in an exported game the importer's `ctx.read('<name>.meta')`
finds nothing and every texture falls back to the project default: pixel-art
loses its `nearest` filter, data maps lose `linear` color space.

## Decision

**Bake each sidecar's import settings into the manifest, and have the bundle
asset source synthesize the `.meta` read** — leaving the engine importer
untouched.

- **Manifest carries the settings.** `AssetManifestEntry` gains an optional
  `meta?: Record<string, unknown>` — the sidecar's fields **beyond** the
  sidecar-metadata keys (`version` / `guid` / `kind`). `parseMetaEntry` (build
  scan) extracts them; an asset whose sidecar carries nothing extra gets no
  `meta`, so the manifest stays lean. `parseAssetManifest` round-trips it.
- **The bundle source serves a synthesized sidecar.** `RpakAssetSource` builds a
  `"<location>.meta" → JSON bytes` map from the entries' baked `meta`, and
  `read('<name>.meta')` returns those bytes. A `.meta` with no baked entry falls
  through to the GUID lookup (which throws) — exactly the "no sidecar" signal the
  importer already treats as "use defaults".
- **The importer does not change.** It still does `ctx.read('<name>.meta')` →
  `parseTextureMeta`. On disk that hits the file; in the bundle it hits the
  synthesized bytes. One code path, two sources — the `AssetSource` seam does the
  work.

## Consequences

- Exported games apply the same texture import settings as the editor / loose-file
  runtime, with no loose `.meta` shipped and no per-importer bundle awareness.
- The mechanism is generic: any importer that reads a `<name>.meta` sidecar gets
  its settings in the bundle for free (not texture-specific).
- The manifest grows only for assets that actually carry settings.
- **Not covered:** mipmap/trilinear, max-size downscale, and PPU (the rest of the
  ADR-0166 Phase 3 list) — those are separate follow-ups; this ADR is about the
  *delivery* of settings to the bundle, not new settings.

## Implementation

- `packages/assets/src/manifest.ts` — `AssetManifestEntry.meta`; `parseAssetManifest` parses it.
- `packages/build/src/asset-scan.ts` — `parseMetaEntry` bakes the sidecar's extra fields.
- `packages/runtime-web/src/rpak-asset-source.ts` — serve synthesized `<location>.meta` reads.
