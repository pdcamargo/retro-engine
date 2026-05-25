# ADR-0034: `TextureSlicer` — 9-slice sprites for stretchable UI panels

- **Status:** Accepted
- **Date:** 2026-05-25

## Context

Renderer Phase 8.4 ([ADR-0033](ADR-0033-atlas-animation.md)) shipped
`AtlasAnimation` — the time-driven `TextureAtlas.index` ticker. The 2D data
path now covers static sprites (ADR-0031), atlassed sprites (ADR-0032), and
animated sprites (ADR-0033). Every single-quad sprite shape a consumer would
reasonably ask for is in place. The next gap on the 8.x track is 9-slice:
stretchable UI panels (dialog boxes, health bars, scroll backgrounds, button
frames) where four corner quads stay at fixed pixel size while four edges +
the centre stretch to fill `Sprite.customSize`. Without 9-slice, a stretched
sprite either smears its border or forces the consumer to author one image
per panel size — neither is acceptable for a working game UI.

Bevy's shape is `SpriteImageMode::Sliced(TextureSlicer { border, … })` — a
toggle on the sprite component that turns one quad into nine, with the
border carved off the source UV in source-image pixels. The data is one
discriminated-union enum on `Sprite`, the cost is one router branch in the
per-instance packer, and the surrounding pipeline (atlas-sync,
atlas-animation, sprite-bounds, queue, draw) is untouched.

Out of scope for this ADR (each documented in §"Not yet done" with its
trigger):

- **Tile scale mode** (`sidesScaleMode: 'tile'`, `centerScaleMode: 'tile'`) —
  needs UV repetition + stretch-fit logic.
- **`maxCornerScale` enforcement** — corner-quad shrink when the destination
  is smaller than the border sum.
- **`SpriteImageMode.Tiled`** (repeating a whole sprite across a region) —
  different concern from 9-slice.
- **`SpriteImageMode.ScaleMode`** (letterboxing) — different concern; future
  camera/projection phase.
- **Per-slice tint or per-slice UV override** — not in Bevy either.
- **flipX/flipY layout-reorder semantics** — 8.5 applies flip per-slice
  (each region mirrors locally); reordering slice columns/rows lands when a
  consumer needs it.
- **Per-slice frustum culling** — sliced sprites share one footprint AABB.

## Decision

1. **Phase 8.5 lives in `packages/engine/src/sprite/`.** One concern per file
   (CLAUDE.md §5.5). The slicer belongs to the sprite story, mirroring how
   ADR-0032 folded the atlas asset under `sprite/` rather than carving out a
   new `panel/` submodule. New file: `texture-slicer.ts` + sibling test
   `sprite-slice.test.ts`.

2. **Three new value-shape types in `texture-slicer.ts`.**
   - `BorderRect` — `{ left, right, top, bottom }` in **source-image
     pixels**. Four-arg constructor for asymmetric borders; static
     `BorderRect.all(px)` factory for the common symmetric case. `top` /
     `bottom` reference the destination footprint as it appears in
     world-space (Y-up, matching `SpriteAnchor`), with `top` = the higher-Y
     edge.
   - `TextureSlicer` — `{ border: BorderRect; centerScaleMode:
     SliceScaleMode; sidesScaleMode: SliceScaleMode; maxCornerScale?:
     number }`. Options-bag constructor. `centerScaleMode` and
     `sidesScaleMode` default to `'stretch'`; only `'stretch'` is a valid
     `SliceScaleMode` in this phase (the type is forward-compat seam for a
     future `'tile'` value). `maxCornerScale` is parsed and stored but not
     enforced — see §"Not yet done."
   - `SpriteImageMode` — discriminated union:
     `{ kind: 'auto' } | { kind: 'sliced'; slicer: TextureSlicer }`. Stored
     on `Sprite` as a new optional `imageMode?: SpriteImageMode` field.
     `undefined` and `{ kind: 'auto' }` behave identically — every existing
     sprite remains a single-quad render with no migration. Fully
     backwards-compatible.

3. **`Sprite` gains one optional field.** `sprite.ts` adds `imageMode?:
   SpriteImageMode` to `SpriteOptions` and to the class. Constructor stores
   `options.imageMode` (no default — `undefined` matches the legacy shape).
   `static readonly requires` is unchanged: a 9-slice sprite needs the same
   transform / visibility components as a regular one.

4. **Hot-path router lives in `packSpriteInstance`.** When
   `sprite.imageMode?.kind === 'sliced'`, the function delegates to a new
   `packSlicedSpriteInstances` helper that emits **9 packed instances** in
   fixed `BL → BM → BR → ML → MM → MR → TL → TM → TR` order (rows
   bottom-up, columns left-to-right; Y-up footprint-local). The default
   path stays unchanged byte-for-byte. The return-value contract — "number
   of f32 slots written" — is preserved: the default path returns
   `SPRITE_INSTANCE_FLOAT_COUNT`, the sliced path returns
   `9 * SPRITE_INSTANCE_FLOAT_COUNT`. Existing tests and benches keep their
   signatures.

5. **Slice math.** Footprint pixel size `W × H` (from `sprite.customSize`,
   falling back to `imageSize`). Source UV rect from `sprite.rect`, falling
   back to `[0, 1]²`. Border (`bL, bR, bT, bB`) splits both spaces:
   - Destination footprint splits in `[0, 1]²` (Y-up):
     `dxL = bL / W`, `dxR = 1 − bR / W`, `dyB = bB / H`, `dyT = 1 − bT / H`.
   - Source UV splits inside `[uMin, uMax] × [vMin, vMax]`:
     `uL = uMin + bL / imageSize.width`,
     `uR = uMax − bR / imageSize.width`,
     `vB = vMin + bB / imageSize.height`,
     `vT = vMax − bT / imageSize.height`.

   Each of the 9 slices is one instance whose basis is
   `(sub.xSpan × fullBasisX, sub.ySpan × fullBasisY)` and whose "center"
   field places the (0, 0) corner of the unit quad at the world position
   of the sub-quad's bottom-left footprint corner — derived as
   `translation − (anchorX − sub.xLo) · fullBasisX − (anchorY − sub.yLo) ·
   fullBasisY`. The vertex shader's existing `center + corner.x · basisX +
   corner.y · basisY` formula handles every slice uniformly with no shader
   change.

6. **Border units are source-image pixels, atlas-aware.**
   `bL / imageSize.width` converts pixels → UV against the *full* source
   image. For an atlassed sprite, the atlas image and any tile within it
   share the same pixel scale — so `8` source-pixels carves an 8-pixel
   inset off whichever tile a `TextureAtlas` writes into `sprite.rect`.
   The slicer composes with atlas-sync and atlas-animation for free.

7. **Prepare loop fans out on instance count.** `sprite-plugin.ts`'s
   `prepareSprites` changes in exactly two places:
   - A pre-count walk before `ensureCapacity` sums per-entity instance
     counts (9 for sliced, 1 otherwise) into the buffer-size target. One
     extra walk over `entries` — cheaper than over-allocating 9× upfront
     when most scenes are mostly plain sprites with a few panels.
   - The per-entity cursor advance becomes `cursorInstances += consumed /
     SPRITE_INSTANCE_FLOAT_COUNT` instead of `+= 1`. `consumed` is always
     a multiple of `SPRITE_INSTANCE_FLOAT_COUNT` (integer-exact).

   Batch formation, draw issuance, and the queue path are unchanged. A
   9-sliced sprite contributes 9 contiguous instances to its `(image,
   bucket)` batch; `drawIndexed(6, batch.count, …)` already uses instance
   count, not entity count.

8. **AABB unchanged.** `calculate-sprite-bounds.ts` derives the footprint
   from `customSize → atlas tile size → image size`. A 9-slice sprite has
   the same footprint as a non-sliced one — the slicing is internal
   subdivision, not a size change. The visibility pipeline sees one AABB
   per entity regardless of slice count.

9. **`flipX/flipY` is applied per-slice.** The same swap the default
   packer does on `(uMin, uMax)` / `(vMin, vMax)` is applied to each
   slice's UV range. For symmetric panel textures (the common 9-slice
   case) this is invisible. For an asymmetric source, each sub-region
   mirrors *locally* but the slice layout does not reorder — the corner
   that would have rendered top-left still renders top-left, just sampling
   its mirrored source. Consumers who need a full "flip and reorder"
   semantic can compose with a negative-scale `Transform` (which the
   basis-vector affine handles correctly) or wait for the documented
   "Not yet done" extension.

10. **Degenerate cases are silent no-ops, not throws.**
    - `border.left + border.right > W` (or vertical equivalent): the inner
      splits cross, the affected slices have negative basis, the vertex
      shader produces degenerate quads — visually broken but no crash.
      Consumers should size `customSize` ≥ border sum on each axis.
      Proper handling is `maxCornerScale` enforcement — see §"Not yet
      done."
    - `imageMode = { kind: 'sliced', slicer }` with `customSize` omitted:
      footprint defaults to `imageSize`; the slicer carves the source 1:1.
      Valid (the sprite renders the source at native size with 9 internal
      quads instead of 1), just rarely useful — set `customSize` to
      activate the visible-stretch behaviour.
    - Border ≥ imageSize: source-UV splits cross; same degenerate outcome
      — no crash.

11. **`SpritePlugin` is unchanged.** No new system registration, no new
    resource. The slicer is pure data plus one hot-path branch in
    `packSpriteInstance`. A custom 2D pipeline that wanted slicing without
    instantiating `SpritePlugin` could call `packSpriteInstance` with a
    sliced sprite directly — the routing is inside the function.

Composition-only. No abstract `SpriteShape` base class, no per-mode
subclass, no parallel "9-slice plugin." One discriminated union on the
existing `Sprite` component, one branch in the existing packer, one extra
walk in the existing prepare loop.

## Consequences

**Easier:**

- Stretchable UI panels are first-class. A dialog box that scales to fit
  variable-length text is one sprite + one `imageMode`, not nine sprites
  or a re-authored image per size. The corners stay crisp at every
  destination size — the visible-correctness property a panel needs.
- 9-slice composes with the rest of the 2D data path without effort.
  Atlassed 9-slice, animated 9-slice, parented 9-slice — every existing
  feature on the sprite hot path inherits the slicer for free.
- Forward-compat seams (`SliceScaleMode`, `SpriteImageMode` discriminated
  union, `maxCornerScale` slot) are in place for the deferred tile mode
  and corner-shrink modes; a future ADR adds variants without breaking
  the 8.5 surface.
- The same `Sprite` + `Transform` shape powers regular sprites, atlassed
  sprites, animated sprites, and 9-slice panels. Authors don't switch
  components or plugins to access the modes — they toggle a single field.

**Harder / accepted trade-offs:**

- **9× instance volume per sliced sprite.** A scene with 1000 9-slice
  panels packs 9000 instances. The prepare hot path is roughly 3.3×
  slower per sprite for 9-sliced vs `auto` (per `sprite-slice.bench.ts`).
  Acceptable in absolute terms — 1000 sliced panels pack in ~70 µs on the
  baseline machine — and well below the regression bound when 9-slice is
  used where it should be (panels and HUD elements, not particle fields).
- **One extra pre-count walk in `prepareSprites`.** O(N) over visible
  sprites before the main pack loop, to size the instance buffer
  correctly. Cheaper than over-allocating 9× the headroom for every
  frame. The cost is `entries.length` worth of one field read +
  conditional.
- **flipX/flipY semantics on sliced sprites with asymmetric source are
  documented but not implemented.** A consumer who needs a flipped panel
  whose left and right sides are visually distinct will see each
  sub-region mirror in place, which may not be the intent. The "Not yet
  done" entry documents the workaround (negative-scale `Transform`) and
  the trigger for adding the full semantic.
- **`maxCornerScale` is parsed but ignored.** Sliced sprites whose
  `customSize` is too small for the border sum render as degenerate
  overlapping quads instead of shrinking the corners to fit. The
  documented mitigation is to size `customSize` ≥ border sum until a
  consumer asks for the corner-shrink behaviour.
- **Border units are full-image pixels, not tile pixels.** Documented in
  `BorderRect` TSDoc, but a consumer who reasons in "tile pixels" for
  atlassed sprites needs to do the multiplication mentally. The
  alternative (auto-deriving the conversion factor from `sprite.rect` and
  `imageSize`) drifts from the Bevy semantic and would surprise the
  common consumer who authors the atlas at native scale.

## Not yet done

Each entry below is deferred until its trigger consumer lands.

- **Tile scale mode** (`sidesScaleMode: 'tile'`, `centerScaleMode:
  'tile'`) — needs UV-repetition + stretch-fit logic plus a fragment-side
  branch (or per-row instancing). The `SliceScaleMode` type is the seam.
- **`maxCornerScale` enforcement** — corner-quad shrink when the
  destination is smaller than the border sum. The field is stored;
  enforcement lands when a consumer hits the degenerate visual.
- **`SpriteImageMode.Tiled`** (repeating a whole sprite across a region)
  — different concern from 9-slice; would add a `{ kind: 'tiled'; … }`
  variant when it lands.
- **`SpriteImageMode.ScaleMode`** (letterboxing) — different concern;
  future camera/projection phase.
- **Per-slice tint or per-slice UV override** — niche; add on demand.
- **flipX/flipY with reordered slice layout** — the full semantic where
  flipX swaps the column order in addition to mirroring each column's UV
  (so an asymmetric panel mirrors as a unit). 8.5 ships per-slice
  mirroring only; full reorder lands when a consumer needs it.
- **Per-slice frustum culling** — sliced sprites share one footprint
  AABB; the 9 sub-quads share one visibility test. Per-slice culling is
  marginal unless a single sliced sprite spans the entire screen with
  large unused borders, which is unusual.

## Implementation

- `packages/engine/src/sprite/texture-slicer.ts` — `BorderRect` class,
  `TextureSlicer` class, `TextureSlicerOptions`, `SliceScaleMode`,
  `SpriteImageMode` discriminated union.
- `packages/engine/src/sprite/sprite.ts` — `SpriteOptions` and `Sprite`
  class gain optional `imageMode?: SpriteImageMode`.
- `packages/engine/src/sprite/sprite-batch.ts` — `packSpriteInstance`
  becomes a router. New `packSlicedSpriteInstances` private helper emits
  9 packed instances per sliced entity and returns `9 ×
  SPRITE_INSTANCE_FLOAT_COUNT`. Existing default path is unchanged
  byte-for-byte.
- `packages/engine/src/sprite/sprite-plugin.ts` — `prepareSprites` adds a
  pre-count walk that sums per-entity instance counts before
  `ensureCapacity`; the per-entity cursor advance becomes `cursorInstances
  += consumed / SPRITE_INSTANCE_FLOAT_COUNT`. New private helper
  `instanceCountForSprite` returns 9 for sliced sprites, 1 otherwise.
- `packages/engine/src/sprite/index.ts` — re-exports `BorderRect`,
  `TextureSlicer`, `TextureSlicerOptions`, `SliceScaleMode`,
  `SpriteImageMode`.
- `packages/engine/src/index.ts` — re-exports the sprite module's new
  surface from the engine root.
- `packages/engine/src/sprite/sprite-slice.test.ts` — five test cases:
  symmetric 9-slice pack against a square source, asymmetric border
  per-corner coverage, backwards-compat (omitted `imageMode` → 1
  instance), atlassed integration (one entity → 9 instances inside the
  tile UV), animated + sliced (animator advances → atlas-sync writes →
  packer reads new rect → 9 instances inside the new tile).
- `packages/engine/bench/sprite-slice.bench.ts` — two mitata benches in
  one summary: 1000 sprites auto vs 1000 sprites 9-sliced. Captures the
  per-slice fan-out cost separately from the default sprite pack.
- `packages/engine/bench/index.ts` — registers the new bench.
- `apps/playground/src/slice-showcase-plugin.ts` — `?mode=slice` visual
  harness: one centered 9-sliced "panel" sprite + one unsliced reference
  panel of the same texture, both driven by a sinusoidal `Pulse` system
  that animates `customSize`. The corners on the sliced panel stay
  visibly crisp at every footprint while the unsliced reference smears.
- `apps/playground/src/main.ts` — adds the `?mode=slice` branch to the
  mode-dispatch ternary.
- `.changeset/sprite-slice.md` — public-surface delta (minor bump for
  `@retro-engine/engine`).
