---
'@retro-engine/ui': minor
---

feat(ui): author CSS grid from `.rss`

Phase 2b of grid layout (ADR-0167). The `.rss` style resolver now maps
`display: grid`, `grid-template-columns`, and `grid-template-rows`, so a grid is
authored from a stylesheet, not just `UiNode` init:

```css
.inventory {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 64px 64px;
  gap: 8px;
}
```

Template values are kept as CSS strings and parsed at layout time, so this needed
no new reflection. Grid is now usable end to end (core → layout → authoring);
explicit placement, `auto`/`minmax`, alignment, and auto-rows remain follow-ups.
