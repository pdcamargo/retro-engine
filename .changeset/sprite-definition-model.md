---
'@retro-engine/engine': minor
---

feat(engine): sprite definition model + resolver

Sprite definitions Phase A. `SpriteDefinition` is the serializable `.meta` shape a
Sprite Editor authors — `mode` (single/multiple), a `grid` or `rects` slicing
`source`, `ppu`, and per-slice `slices` (pivot / border / name).
`resolveSpriteDefinition(def)` turns it into `{ layout, sprites }`: it builds a
`TextureAtlasLayout` via `fromGrid` / `fromRects`, computes each slice's pixel
size (so `customSize = pixelSize / ppu`), and applies per-slice pivot / border /
name (defaults: `center` pivot, `DEFAULT_PPU` = 100, index as name).

Pure and unit-tested. Minting each slice as an addressable sub-asset (composite
GUID) and the Sprite Editor UI are tracked follow-ups.
