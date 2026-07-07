---
'@retro-engine/ui': minor
---

feat(ui): display:grid layout integration

Phase 2 of grid layout (ADR-0167). `UiStyle` gains `display: 'flex' | 'grid'` and
`gridTemplateColumns` / `gridTemplateRows` (CSS-syntax strings, e.g. `"1fr 2fr
40px"`, parsed by `parseGridTemplate`; `gap` applies to both axes). The
`FlexLayoutEngine` now branches on `display: 'grid'`: it computes the grid for the
node's content box and lays each in-flow child into its cell, row-major, stretched
to fill:

```ts
new UiNode({ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 8 })
// its four children tile the content box in a 2×2 grid
```

Grid fields reflect as plain strings/enum, so they round-trip. Children past the
last cell get a zero-size rect for now (grid auto-rows are a later phase), and
`.rss` grid authoring + explicit placement / `auto` / `minmax` / alignment are
tracked follow-ups.
