---
'@retro-engine/ui': minor
---

feat(ui): CSS grid layout core (track sizing + cell geometry)

Phase 1 of grid layout (ADR-0167): the pure track-sizing + cell-geometry
algorithm behind the `LayoutEngine` seam. `GridTrack` is `{ kind: 'px' }` or
`{ kind: 'fr' }`; `resolveGridTracks(tracks, available, gap)` reserves fixed
tracks + gaps then splits the leftover among `fr` tracks by fraction (clamped);
`computeGridLayout(spec, available)` resolves column + row tracks and returns each
cell's `LayoutRect`, row-major:

```ts
computeGridLayout(
  { columns: [{ kind: 'px', value: 50 }, { kind: 'fr', value: 1 }], rows: [{ kind: 'fr', value: 1 }], columnGap: 10 },
  { width: 210, height: 100 },
); // → columnSizes [50, 150], one cell rect per grid cell
```

Pure and unit-tested. Wiring it into `UiStyle` (`display: grid` +
`grid-template-*`) and the layout-engine tree (placing children into cells),
plus `auto`/`minmax`/placement/alignment, are tracked follow-up phases.
