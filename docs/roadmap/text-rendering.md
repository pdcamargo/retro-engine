# Engine Text Rendering (MSDF)

- **Created:** 2026-07-06
- **Status:** In progress (Phase 1 shipped 2026-07-06)
- **ADR:** [ADR-0149](../adr/ADR-0149-engine-text-msdf.md)

## Goal

Crisp game-facing text at any scale/rotation via MSDF, in `packages/engine/src/text/`.
Font atlases are generated offline (`msdf-atlas-gen`) and loaded as assets; the
runtime shapes text (layout) and batches glyph quads through the 2D pipeline with
an MSDF shader. Required by the in-game UI system.

## Phases

### Phase 1 — Font data + layout engine (pure) ✅ (2026-07-06)

- `FontMetrics` / `GlyphMetrics` / `MsdfFont`; `parseMsdfFont` (msdf-atlas-gen JSON).
- `layoutText` (positioned glyph quads: advance, `\n`, word-wrap at max width,
  horizontal alignment, line height) + `measureText` (bounds, for the UI measure
  callback). Fully unit-tested, no GPU.

### Phase 2 — Rendering

- `Font` asset kind + importer (JSON + sibling atlas `.png` → `Image`); `.meta`.
- `Text2d` component (text, font handle, size, color, align, maxWidth),
  reflection-registered.
- MSDF WGSL shader (median-of-RGB, screen-px-range AA) + glyph-quad batching
  through the 2D pipeline; `TextPlugin`.
- Playground `?mode=text` draws multi-line styled text; a default font atlas is
  committed for samples/tests.

### Phase 3 — Depth

- World-space `Text` (3D); rich text runs / per-run styling; wire `measureText`
  into the in-game UI layout measure callback; RTL/bidi (later).

## Open questions (resolved / remaining)

- **Package vs engine?** → in `packages/engine/src/text/` (deep 2D-pipeline
  coupling), per ADR-0149.
- **Runtime atlas generation?** → out of scope; atlases are offline-baked and
  shipped. Dynamic/CJK glyph sets revisited when a consumer needs it.
- **Bitmap fallback?** → MSDF only for now (one scalable path).

## Links

- [ADR-0149](../adr/ADR-0149-engine-text-msdf.md)
- Chlumsky `msdf-atlas-gen` / `msdfgen`; awesome-msdf shader reference
