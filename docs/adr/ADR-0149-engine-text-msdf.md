# ADR-0149: Engine text rendering (MSDF)

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

The engine has no game-facing text — only the ImGui editor overlay draws text,
and that is editor-only. A game needs to draw crisp UI/HUD/world text at any
scale and rotation, and the in-game UI system (a later P0) depends on text +
glyph metrics for its layout measure step.

The standard technique for scalable GPU text is **MSDF** (multi-channel signed
distance fields, Chlumsky): a font is baked offline into an atlas texture whose
RGB channels encode a signed distance field; the shader reconstructs a crisp edge
at any size by taking the median of the three channels and thresholding it against
a screen-space-derivative-scaled range. The atlas + per-glyph metrics are produced
by `msdf-atlas-gen` as a `.png` + a `.json` (an `atlas` section with
`distanceRange` / size, a `metrics` section in em units, and a `glyphs` array with
`advance` + `planeBounds` (em) + `atlasBounds` (texture px)).

Constraints:

- **Offline generation.** `msdfgen`/`msdf-atlas-gen` are native tools; the atlas
  is generated in the asset pipeline and shipped as data, not generated at
  runtime. The runtime *loads* the atlas.
- **Reuses the 2D pipeline.** Glyphs are textured quads — the existing sprite /
  2D batching infrastructure (in `packages/engine`) is the natural substrate, so
  text is tightly coupled to the renderer and belongs *in* the engine, not a
  layered package (unlike input/audio/physics).
- **Layout is pure logic.** Shaping a string into positioned glyph quads
  (advance accumulation, line breaks, word wrap, alignment) needs only the font
  metrics — no GPU — so it is unit-testable and reusable by the UI measure step.

## Decision

Text ships **inside `packages/engine`** (`packages/engine/src/text/`), as a
`TextPlugin` registering a `Font` asset kind and `Text2d` component, mirroring how
`sprite/` and `material/` live in the engine. It is built in phases:

- **Data + layout (this phase, pure).** `FontMetrics` (em-space line metrics),
  `GlyphMetrics` (advance + plane/atlas bounds per codepoint), and `MsdfFont`
  (metrics + glyph map + `distanceRange` + atlas dimensions), parsed from the
  `msdf-atlas-gen` JSON by `parseMsdfFont`. A pure `layoutText(font, text,
  options)` shapes text into `PositionedGlyph[]` (pixel-space quad + atlas UV
  rect per visible glyph) honoring font size, line height, `\n`, word wrap at a
  max width, and horizontal alignment; `measureText` returns just the bounds (the
  hook the UI layout measure callback will call). All unit-tested, no GPU.
- **Rendering (next phase).** A `Font` asset kind + importer (JSON + sibling
  atlas `.png` as an `Image`), the `Text2d` component (reflection-registered),
  an MSDF WGSL shader (`median(r,g,b)`; `screenPxRange = max(0.5 · dot(unitRange,
  screenTexSize), 1)`; `opacity = clamp(screenPxRange·(median−0.5)+0.5, 0, 1)`),
  and glyph-quad batching through the 2D pipeline. A playground sample draws
  multi-line styled text.
- **Depth (later).** World-space `Text`, rich runs/styling, and the UI layout
  integration.

The atlas is **backend-neutral data** (a texture + metrics), so no
`RendererCapabilities` flag is needed — it renders through the same 2D quad path
that already works on WebGPU (and will on WebGL2).

## Consequences

- The layout engine is pure and fully unit-tested now, de-risking the algorithmic
  core (line breaking, wrapping, alignment, metrics) before any GPU work, and is
  immediately reusable by the UI measure step.
- Coupling text to the engine (not a package) matches its deep dependence on the
  2D batching pipeline; the trade-off is a larger `engine` package, consistent
  with `sprite`/`material` already living there.
- Relying on offline `msdf-atlas-gen` means the engine ships a *loader*, not a
  generator; a default font atlas is committed for samples/tests. Runtime atlas
  generation (dynamic glyph sets, CJK) is out of scope — a documented limitation,
  revisited if a consumer needs it (not a genre-based cut; a real cost/dependency
  one — it would pull msdfgen into the runtime).
- MSDF gives crisp text at any scale/rotation from one atlas, at the cost of a
  slightly more complex shader than bitmap fonts — the right trade for a scalable
  engine.

## Implementation

- `packages/engine/src/text/font.ts` — `FontMetrics`, `GlyphMetrics`, `MsdfFont`.
- `packages/engine/src/text/msdf-parser.ts` — `parseMsdfFont`.
- `packages/engine/src/text/text-layout.ts` — `PositionedGlyph`, `layoutText`, `measureText`.
- `packages/engine/src/text/*` (next phase) — `Font` asset kind + importer, `Text2d`,
  MSDF shader, glyph batching, `TextPlugin`.
