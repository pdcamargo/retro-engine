# CSS Grid for the UI layout engine

A pure-TS grid layout mode behind the `LayoutEngine` seam (Taffy-WASM only as a
fallback escape hatch). Promoted from the P1 item.

## Phase 1 — track sizing + cell geometry ✅ (ADR-0167)

Standalone pure core: `GridTrack` (`px` / `fr`), `resolveGridTracks` (px reserve →
gap reserve → fr split, clamped), `computeGridLayout(spec, available)` → resolved
column/row sizes + row-major cell rects. Unit-tested (fr distribution, mixed
px+fr, gaps, over-full clamping, cell offsets). No `UiStyle`/ECS change yet.

## Phase 2 — style fields + LayoutEngine integration

Add `UiStyle` `display: 'flex' | 'grid'` + `gridTemplateColumns` /
`gridTemplateRows` (parsed from `.rss`, e.g. `grid-template-columns: 1fr 2fr 40px`)
+ row/column gap. In the layout engine, a `display: grid` node computes its
content box, calls `computeGridLayout`, and lays each child into a cell (default:
sequential row-major). Children keep their own layout for their subtree.

## Phase 3 — placement + `auto`/`minmax` + alignment

Explicit placement (`grid-column` / `grid-row`) and spanning; `auto` and
`minmax()` tracks (using the child intrinsic-measure hook); grid-level
`justify-items` / `align-items` / `justify-content` / `align-content`.
