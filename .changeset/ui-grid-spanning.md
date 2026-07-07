---
'@retro-engine/ui': minor
---

feat(ui): grid item spanning + auto-placement

Phase 3a of grid layout (ADR-0167). Grid items can span multiple tracks and are
auto-placed by a CSS-style sparse algorithm. `placeGridItems(tracks, items)`
walks cells row-major and drops each item at the first free top-left cell where
its `colSpan × rowSpan` block fits, marking those cells occupied so later items
flow past. `UiStyle` gains `gridColumnSpan` / `gridRowSpan`, authored from `.rss`
via `grid-column` / `grid-row` (`span N` or a bare number):

```css
.hero { grid-column: span 2; grid-row: span 2; }
```

The layout engine now places grid children through `placeGridItems`, so a spanned
child covers its block and subsequent children fill the remaining cells. Explicit
line placement (`1 / 3`), `auto`/`minmax` tracks, alignment, and auto-rows remain
follow-ups.
