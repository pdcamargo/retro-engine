---
'@retro-engine/engine': minor
---

feat(engine): MSDF glyph render pipeline for Text2d (phase 2b)

`TextPlugin` now renders `Text2d` entities. Added:

- `retro_engine::text` WGSL — an MSDF shader that reconstructs a crisp edge from
  the median of the atlas's RGB distance channels, scaled to screen pixels via
  the font's `distanceRange` and the texture-coordinate derivative for
  resolution-independent antialiasing.
- `TextPipeline` (a `SpecializedRenderPipelines` keyed on the render-target
  shape; always alpha-blended), `TextInstanceBuffer` (growable per-frame glyph
  buffer), and `TextPreparedBatches`.
- `packGlyphInstance` — packs a laid-out glyph quad (block-local, y-down) into
  world-space instance data honoring the entity transform and block pivot, plus
  the per-glyph atlas UVs and MSDF `unitRange`.
- `text-prepare` (after `image-prepare`) + `text-queue` render systems: lay out
  visible text, pack glyph quads in one upload, and queue one instanced
  transparent draw per text entity into the 2D phase.

Text entities now draw; a text with no font, an unloaded font, or a
whitespace-only string produces no draw. Verified end-to-end through the
capturing renderer (transparent-pass draw calls, per-entity batching, instance
counts, atlas bind group). A committed sample font + `?mode=text` playground
scene follow in the next slice.
