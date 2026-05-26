# ADR-0036: Z-aware sprite batching — sort-then-walk prepare path with per-batch maximum `worldZ`

- **Status:** Accepted
- **Date:** 2026-05-25

## Context

Renderer-roadmap Phase 8.7 (sealed by ADR-0035 §10) flipped the Core2d `Opaque2d` and `AlphaMask2d` phase comparators from front-to-back to back-to-front. Without a depth attachment the CPU sort is the only thing controlling visual order; the previous ascending sort silently painted farther entities over nearer ones whenever opaque content overlapped in Z, and the Material2d showcase made the breakage user-visible.

The sprite prepare path predates that flip. `extractAndBatchSprites` in `packages/engine/src/sprite/sprite-plugin.ts` collected visible sprites into a `Map<"${imageHandle}|${bucket}", PerSpriteEntry[]>` and emitted one `SpriteBatch` per key, with `worldZ` captured from **the first sprite seen for that key**. Every sprite in a batch then shared one `sortDepth` derived from that single Z, and the per-instance write order matched ECS iteration order. For a same-image parallax scene (the natural shape Phase 8.7 enables for opaque content) the painter order within a batch was the wrong order — the phase sort placed the batch correctly relative to other batches but could not interleave a batch's interior with a foreign-image sprite at an intervening Z.

Phase 8.8 closes that gap. The deliverable is "two same-image sprites at Z = -10 and Z = +10 with a foreign-image sprite at Z = 0 between them render as three batches in back-to-front order, and N same-image sprites at distinct Z values collapse to one batch with per-instance order back-to-front."

Out of scope for this ADR (each documented in §"Not yet done" with its trigger):

- **Cross-frame batch persistence.** The batch list is rebuilt every frame; a same-image scene with stable Z order would benefit from a memo'd batch boundary, but until a measured-perf consumer asks for it the rebuild stays cheap.
- **Sprite + Material2d shared phase items.** Different pipelines, no shared batching planned (already documented in ADR-0035 §"Not yet done").
- **Mask-mode sprites.** The sprite bucket assignment stays `(color.w >= 1) ? 'opaque' : 'blend'`; routing into `AlphaMask2d` waits for a textured-discard sprite pipeline (tilemaps).
- **Hierarchical / bucketed sort to amortize cost.** A pre-partition by bucket + per-bucket sort would save the bucket comparison but adds a partition pass; TimSort hits its O(n) fast path on a flat sort keyed bucket-first anyway. Revisit only if a 10k-sprite workload exceeds the informational ~0.5 ms budget.
- **Extracting the per-camera 4-term sort-depth formula to a shared util.** Three sites (Material3d, Material2d, sprite) inline the same projection; sprite's 2-term shortcut differs from the others. Extract when a fourth site appears (already deferred in ADR-0035 §"Not yet done").

## Decision

1. **Prepare flow is sort-then-walk.** `prepareSprites` collects `PerSpriteEntry` records (one per visible sprite), sorts them in-place by `(bucketKey, -worldZ, imageHandle)`, then walks the sorted list once emitting a new `SpriteBatch` whenever consecutive entries differ on `(imageHandle, bucketKey)`. The `Map<key, PerSpriteEntry[]>` grouping and the `order[]` tracker are gone.

2. **`PerSpriteEntry` carries the sort keys directly.** New `bucketKey: 0 | 1` (`0 = 'opaque'`, `1 = 'blend'`) and `worldZ: number` (mirror of `gt.matrix[14]`) populated at collection time. The comparator deref's only these flat numeric fields; V8 TurboFan inlines a numeric comparator cleanly but degrades when the body walks nested objects like `entry.gt.matrix`. Keeping the comparator monomorphic in `number` ops is the single load-bearing perf decision in this ADR.

3. **Sort key is `(bucketKey asc, worldZ desc, imageHandle asc)` with `Array.prototype.sort`.** ES2019 guarantees stability, so two entries identical on all three keys preserve ECS-iteration order — the only sensible tiebreak. `bucketKey` is primary because the alternative (Z-primary) would let an opaque/blend mix at distinct Z values fragment same-image runs across the bucket boundary; bucket-primary keeps each bucket's same-image runs contiguous. `imageHandle` is tertiary so equal-Z sprites of different images form contiguous mini-runs; visual order is undefined at identical Z so this tiebreak only affects batching, not correctness.

4. **Walk-emit invariant.** Within each bucket: no batch contains a sprite whose `worldZ` is strictly greater than any sprite's `worldZ` in a batch that follows it. This is the correctness statement consumed by the phase-item sort — the phase comparator orders batches by their `worldZ`, and the invariant guarantees that ordering produces the correct painter sequence for the batch's interior too. Ties on `worldZ` across different images at the same Z plateau are visually equivalent regardless of which renders first.

5. **`SpriteBatch.worldZ` is the maximum `worldZ` in the batch.** After the back-to-front sort the first packed instance of each batch carries the maximum Z, so the capture at batch-open time is the simple `e.worldZ` of the first entry. The TSDoc says "maximum `worldZ` in the batch" rather than "back-most" — per-camera back/front direction comes from the view matrix's `v[10]` multiplication in the queue's `sortDepth = v[10] * batch.worldZ + v[14]`. The wording stays correct under flipped or rotated 2D cameras.

6. **Worst-case behaviour is bounded.** When every consecutive Z transition swaps image and bucket, each entry becomes its own batch — `count = 1`, `firstInstance` advances by one per batch. Equivalent to no batching, correct draws. Best case (all same image + bucket) collapses N entries into one batch with `count = N`. Real workloads cluster in between.

7. **Hot path lives in its own file.** `sortAndEmitSpriteBatches`, `PerSpriteEntry`, `SpriteImageSizeLookup`, and `instanceCountForSprite` move from `sprite-plugin.ts` into `sprite-batch-prepare.ts` (CLAUDE.md §5.5: one concern per file). The bench imports just the prepare module without paying the App / ECS / render-graph import cost; the plugin imports the function and types from the same module.

8. **9-slice sprites are unchanged.** A 9-sliced sprite contributes 9 contiguous instances to `count` at the parent's `worldZ`. `instanceCountForSprite` returns 9, `packSpriteInstance` writes 9 contiguous records, and the walk-emit loop treats each entry atomically — all 9 slice instances inherit the parent's batch position.

9. **Sprite bucket mapping is unchanged.** `(color.w >= 1) ? 'opaque' : 'blend'`. Routing into `AlphaMask2d` waits for a future textured-discard sprite pipeline; Material2d remains the only writer to that slot today.

10. **Batch identity is not stable across frames.** Float drift in `gt.matrix[14]` can swap two entries at nearly-equal Z, shifting batch boundaries frame-to-frame. Nothing downstream interns `SpriteBatch` references (the bind-group cache is keyed by `ImageHandle`, not batch identity), so this is observable only via the prepare scratch and harmless. The `SpriteBatch` TSDoc notes the property explicitly so future consumers don't accidentally rely on it.

Composition-only. The prepare path is a pure function called from one system; no abstract `SpriteBatcher` class, no plugin surface change. The sprite plugin's queue logic and the Core2d phase nodes are unchanged.

## Consequences

**Easier:**

- Same-image parallax for opaque sprites now composites correctly. A Hollow Knight–style multi-layer background of the same atlas tile at varying Z layers composes in painter order without forcing `alphaMode: 'blend'` on opaque layers (Phase 8.7 fixed the cross-batch order; Phase 8.8 fixes the within-batch order — together they cover every Z layout the user can build).
- The prepare path is more testable. Three new integration tests in `sprite-plugin.test.ts` lock the three regimes (interior parallax, single-batch within-Z order, regression on same-Z multi-image). The within-batch instance order is verified by reading `SpriteInstanceBuffer.scratchU32` directly — the packed RGBA at instance offset `+10` is per-sprite-unique, so tinting each spawn with a known byte gives a free probe.
- The new `sortAndEmitSpriteBatches` function is callable from bench / future tests without booting the App harness. The bench fixtures 10 000 synthetic entries and measures the sort + walk + pack pipeline in isolation; the existing `sprite-batch.bench.ts` continues to measure `packSpriteInstance` arithmetic alone.

**Harder / accepted trade-offs:**

- **Sort cost adds an O(n log n) pass to every prepare frame.** On Apple M4, 10 000 sprites with the new prepare path (sort + walk + pack + per-iteration slice for fair bench measurement) clocks ~1.4 ms; subtracting the pack arithmetic (the same cost the old path paid) and the slice overhead leaves the sort itself at ~0.5–0.8 ms. Worst-case (random distribution) hits TimSort's no-presortedness path; best case (mostly-sorted Z, common in tile-grid scenes) is closer to O(n).
- **The walk-emit loop allocates one `SpriteBatch` literal per emission.** Same allocation count as the previous Map-grouped path (one batch object per `(image, bucket)` group). No new allocation pressure.
- **`PerSpriteEntry` widens by two numeric fields.** Per-entity overhead is +16 bytes (one `number` for `bucketKey`, one for `worldZ`). At 10 000 entities that's 160 KB of transient frame allocation — negligible vs. the instance scratch already in flight.
- **Comparator stability is load-bearing.** ES2019 guarantees `Array.prototype.sort` stability on every supported runtime (Bun, Node 12+, all browsers shipping WebGPU). If a future workload migrates to an unstable sort (e.g. a parallel sort on a worker), the comparator must add an `entity` tiebreak to keep behaviour deterministic.
- **`SpriteBatch.worldZ` semantics changed.** Previously "first sprite's Z" (which was insertion-order-dependent), now "maximum `worldZ` in the batch". No external consumer (grep confirms the only reader is `sprite-plugin.ts`'s queue step) so the change is internal. The TSDoc + ADR-0036 capture the redefinition.
- **Frame-to-frame batch identity churn.** Z drift at the float-precision boundary can shift a same-Z multi-image cluster's batch boundaries on every frame. Mitigation: nothing interns `SpriteBatch` references; the bind-group cache is image-keyed and stable. The TSDoc calls this out explicitly to head off future regressions.

## Not yet done

- **Cross-frame batch persistence / incremental rebuild.** Lands when a measured-perf consumer asks; the per-frame rebuild stays cheap until then.
- **Sprite + Material2d shared phase items.** Different pipelines, no shared batching planned (also deferred in ADR-0035 §"Not yet done").
- **Mask-mode sprites.** Sprite bucket assignment stays opaque/blend; `AlphaMask2d` routing waits for a textured-discard sprite pipeline (tilemaps).
- **Bucketed sort instead of flat sort.** Two-bucket pre-partition + per-bucket sort would save the bucket comparator branch; TimSort on the flat sort hits the same O(n)+O(n log n) cost in practice. Revisit only if a 10k workload exceeds ~0.5 ms on the sort step.
- **Typed-array sort-key triples.** The comparator dereferences `entry.bucketKey` / `entry.worldZ` / `entry.imageHandle` from a heap object on every comparison. Encoding the three keys into a `Float64Array` of packed triples and sorting indices would let V8 inline the comparator to a tight numeric loop — a 3-5× speedup at the cost of permuting the original entries through the index. Not adopted today; the current numbers do not justify it.
- **Per-sphere of influence (sprite + culling) sort.** When the sprite culling pass produces a sub-N visible set per camera, the sort cost on the full N may be wasteful for multi-camera scenes. Phase 12+ camera culling lands first; the per-camera sort optimization comes after.

## Implementation

- `packages/engine/src/sprite/sprite-batch-prepare.ts` — `PerSpriteEntry`, `SpriteImageSizeLookup`, `sortAndEmitSpriteBatches`, `instanceCountForSprite`. Pure module; no App / ECS imports beyond type-only.
- `packages/engine/src/sprite/sprite-batch.ts` — `SpriteBatch.worldZ` TSDoc redefined to "maximum `worldZ` in the batch"; batch-level TSDoc adds the contiguous-Z-range invariant and the frame-to-frame identity note.
- `packages/engine/src/sprite/sprite-plugin.ts` — `prepareSprites` rewritten to populate `bucketKey`/`worldZ` on each entry and delegate to `sortAndEmitSpriteBatches`; the `Map<key, PerSpriteEntry[]>` grouping is gone; `PerSpriteEntry` and `instanceCountForSprite` moved out.
- `packages/engine/src/sprite/sprite-plugin.test.ts` — three new integration cases: interior parallax (3 batches in [A, B, A] order), same-image varying Z (1 batch, packed RGBA back-to-front), same-Z two images (2 batches; regression).
- `packages/engine/bench/sprite-batch-z-sort.bench.ts` — new file fixturing 10 000 entries across two images at random Z values; measures `sortAndEmitSpriteBatches` end-to-end against the prepare path's sort budget.
- `packages/engine/bench/index.ts` — registers the new bench.
- `apps/playground/src/sprite-showcase-plugin.ts` — adds `parallaxPlacements()`: five overlapping checker sprites at Z = 10 / 5 / 0 / -5 / -10 in the bottom-right quadrant. The Z = -10 (blue tint) sprite paints on top.
