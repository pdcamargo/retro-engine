# Sprite definitions (Unity-style)

Author how a texture is sliced into sprites — grid or manual rects, single vs.
multiple, pivot / border (9-slice) / PPU — and mint the slices as addressable
sub-assets. Promoted from the P1 "Sprite definitions (`.meta`, Unity-style)"
roadmap item. Several building blocks already existed and are reused.

## Slicing geometry (engine)

- **Grid slicing ✅** (pre-existing) — `TextureAtlasLayout.fromGrid`
  (tileSize / columns / rows / padding / offset → normalised UV rects).
- **Manual-rect slicing ✅** — `TextureAtlasLayout.fromRects({ size, rects })`
  normalises hand-placed pixel rects (Unity "multiple" mode), order-preserving,
  the counterpart to `fromGrid`. Unit-tested.
- **9-slice ✅** (pre-existing) — `TextureSlicer` / `BorderRect`.
- **PPU** — pixels-per-unit sizing exists via sprite bounds; formalize as a
  definition field.

## Phase A — the `.meta` sprite-definition model ✅

`SpriteDefinition` (`mode` single/multiple; `source` grid|rects; `ppu`; per-slice
`slices` with pivot/border/name) + pure `resolveSpriteDefinition(def)` →
`{ layout, sprites }`: dispatches to `fromGrid`/`fromRects`, computes each slice's
pixel size (for `customSize = pixelSize / ppu`), and applies per-slice
pivot/border/name (defaults: `'center'` pivot, `DEFAULT_PPU`=100, index name).
Unit-tested. (Data model + resolver only — no runtime consumer yet; Phase B mints
from it.)

## Phase B — sub-asset minting

Each slice becomes an addressable sub-asset via a composite GUID (ADR-0126), so a
scene/material can reference "sprite 3 of hero.png". The sprite-sheet importer
reads the definition, builds the layout, and registers one labeled sub-asset per
slice through `LoadContext.addLabeledAsset`.

## Phase C — Sprite Editor UI (studio)

Slice interactively (grid + manual rects), set pivot/border/PPU, write the
definition `.meta`. Studio-side; tracked under the Editor tier.
