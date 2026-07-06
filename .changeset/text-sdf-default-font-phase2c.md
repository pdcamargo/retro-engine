---
'@retro-engine/engine': minor
---

feat(engine): built-in SDF default font — zero-dependency crisp text (phase 2c)

Adds a pure-JS signed-distance-field font generator and a built-in default font,
so text renders with no external font tooling or committed binary assets:

- `generateSdfFont(glyphs, options)` — rasterizes stroke-defined glyphs into a
  single-channel SDF atlas (replicated across RGB so the median-of-RGB shader
  reconstructs it) and returns the RGBA pixels plus parsed `MsdfFont` metrics.
- `generateDefaultFontAtlas()` / `installDefaultFont(app)` — a built-in monoline
  font (uppercase, digits, common punctuation; lowercase aliased to uppercase)
  and a one-call helper that registers its linear atlas image + `Font` and
  returns the handle.

The existing MSDF pipeline consumes the SDF atlas unchanged (single channel =
median). True multi-channel MSDF atlases from `msdf-atlas-gen` still load via the
`.font` importer when that tool is available; the built-in font is the
no-tooling default.
