---
'@retro-engine/engine': minor
---

feat(engine): MSDF text font data + layout engine (phase 1)

Adds the pure, GPU-free core of the engine text system under
`packages/engine/src/text/`:

- `MsdfFont` / `FontMetrics` / `GlyphMetrics` — parsed font data (vertical
  metrics, per-codepoint advances/plane/atlas bounds, kerning, atlas geometry).
- `parseMsdfFont(json)` — validates and parses the JSON produced by
  `msdf-atlas-gen`, throwing loudly on a malformed font.
- `layoutText(font, text, options)` — shapes a string into positioned glyph
  quads (advances, kerning, letter spacing, explicit `\n`, greedy word wrap at
  `maxWidth`, left/center/right alignment) with top-left-origin atlas UVs.
- `measureText(font, text, options)` — the cheap bounds-only path for UI layout.

Rendering (a `Font` asset kind, the `Text2d` component, the MSDF shader, and
glyph batching through the 2D pipeline) lands in a later phase.
