---
'@retro-engine/engine': minor
---

feat(engine): Z-aware sprite batching — sort-then-walk prepare path honours per-sprite Z

Phase 8.8 closes the within-batch ordering gap exposed by Phase 8.7's back-to-front Core2d sort flip. Per ADR-0036. The sprite prepare step now sorts visible sprites by `(alphaBucket, -worldZ, imageHandle)` before walking the sorted list once and emitting a new `SpriteBatch` whenever consecutive entries differ on `(imageHandle, alphaBucket)`. Same-image sprites at varying Z collapse to one batch with per-instance order back-to-front (best case); a foreign-image sprite at an intermediate Z breaks the run automatically and the result is three correct batches in painter order (worst case: one sprite per batch when every Z transition swaps image). The map-based grouping that captured "the first sprite's Z" as the batch sort key is gone.

Same-image parallax for opaque content now composites correctly without forcing `alphaMode: 'blend'` on every layer. Together with the Phase 8.7 sort flip the Core2d painter pipeline is complete for both cross-batch and within-batch ordering across all three phases (`Opaque2d`, `AlphaMask2d`, `Transparent2d`).

**Behaviour changes (non-breaking):**

- `SpriteBatch.worldZ` redefined from "world-space Z of the batch's first sprite" to "maximum `worldZ` across the batch's sprites" (= first packed instance's Z after the back-to-front sort). Internal type — no consumer impact. Wording chosen so the semantics hold under flipped or rotated 2D cameras; per-camera direction continues to come from the view matrix's `v[10]`.
- Sprite batch identity is no longer stable across frames — float drift on `worldZ` can shuffle same-Z batch boundaries. Nothing downstream interns batch references; the bind-group cache is image-keyed.

**New internal surface (not re-exported from the engine package):**

- `packages/engine/src/sprite/sprite-batch-prepare.ts` — `sortAndEmitSpriteBatches(entries, images, scratchF32, scratchU32, out)` pure function, plus `PerSpriteEntry` / `SpriteImageSizeLookup` types and the `instanceCountForSprite` helper. Bench harness uses it directly without booting an App.
