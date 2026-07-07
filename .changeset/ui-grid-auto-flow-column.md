---
'@retro-engine/ui': minor
---

feat(ui): grid-auto-flow: column + implicit auto-columns

Phase 3f of grid layout (ADR-0167). Grid auto-placement can now fill **columns**
first (top-to-bottom, then rightward) instead of rows. `UiStyle.gridAutoFlow:
'row' | 'column'` (default `'row'`) picks the direction, and
`UiStyle.gridAutoColumns` (px) sizes implicit columns — the `'column'`-flow
counterpart to `gridAutoRows`:

```css
.strip { display: grid; grid-template-rows: 40px 40px;
         grid-auto-flow: column; grid-auto-columns: 50px; }
```

Column flow is implemented by transposing onto the existing, tested row-major
placer (via a new `gridTrackCount(fixed, items, flow)` + a `flow` arg on
`placeGridItems`), so the row-flow path is untouched. `.rss` maps
`grid-auto-flow` / `grid-auto-columns`. Layout + resolver unit-tested (column
fill order, row-span under column flow, implicit auto-columns).
