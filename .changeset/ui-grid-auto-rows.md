---
'@retro-engine/ui': minor
---

feat(ui): grid auto-rows (implicit rows)

Phase 3c of grid layout (ADR-0167). Grid items past the explicit
`grid-template-rows` now flow into **implicit** rows instead of collapsing to
zero size. `UiStyle.gridAutoRows` (a fixed pixel height, default `0` = no
implicit rows) sizes them; the layout engine grows the row template to fit before
resolving geometry:

```css
/* two columns, items flow into as many 48px rows as needed */
.list { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 48px; }
```

The placement core is refactored around a shared `assignGridCells` (bounded for
`placeGridItems`, unbounded for the new `gridRowCount`), so span-aware
auto-placement drives both cell geometry and the implicit-row count. `.rss` maps
`grid-auto-rows`. Existing grids (no `gridAutoRows`) are unchanged. Placement,
row-count, and layout are unit-tested.
