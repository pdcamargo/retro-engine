---
'@retro-engine/engine': minor
---

feat(engine): Font asset + Text2d component for MSDF text (phase 2a)

Adds the asset + component layer of the engine text system:

- `Font` asset (parsed `MsdfFont` data + a handle to its MSDF atlas `Image`) and
  the `Fonts` store.
- `createFontImporter` — loads a `.font` descriptor (`msdf-atlas-gen` JSON),
  decodes its companion atlas image into a **linear** texture (distance fields
  are never gamma-decoded), and registers it as a labeled sub-asset. The atlas
  file defaults to a sibling `<base>.png`, overridable via a top-level `"image"`.
- `Text2d` component (text, font handle, size, tint, alignment, line height,
  wrap width, letter spacing, pivot), reflection-registered so it round-trips
  through a saved scene.
- `TextPlugin` — inserts `Fonts`, catalogs the `.font` asset kind, registers the
  loader against the `AssetServer`, and registers the `Text2d` schema.

The glyph render pipeline (MSDF shader + quad batching through the 2D pipeline)
is phase 2b; `TextPlugin` is not yet part of the default plugin set.
