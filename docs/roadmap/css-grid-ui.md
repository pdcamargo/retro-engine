# CSS Grid for the UI layout engine

A pure-TS grid layout mode behind the `LayoutEngine` seam (Taffy-WASM only as a
fallback escape hatch). Promoted from the P1 item.

## Phase 1 — track sizing + cell geometry ✅ (ADR-0167)

Standalone pure core: `GridTrack` (`px` / `fr`), `resolveGridTracks` (px reserve →
gap reserve → fr split, clamped), `computeGridLayout(spec, available)` → resolved
column/row sizes + row-major cell rects. Unit-tested (fr distribution, mixed
px+fr, gaps, over-full clamping, cell offsets). No `UiStyle`/ECS change yet.

## Phase 2 — style fields + LayoutEngine integration ✅ (ADR-0167)

`UiStyle` gained `display: 'flex' | 'grid'` + `gridTemplateColumns` /
`gridTemplateRows` (CSS-syntax strings, e.g. `"1fr 2fr 40px"`, reflection = plain
`t.string`) + reuses `gap` for both grid axes. `parseGridTemplate` turns the
string into `GridTrack[]`. The `FlexLayoutEngine` branches on `display: 'grid'`:
it calls `computeGridLayout` for the content box and lays each in-flow child into
its cell (row-major, stretched to fill; children past the last cell get a
zero-size rect — auto-rows are Phase 3). Children recurse normally into their
subtree. Reflection-registered. Layout unit-tested (2×2 fr; px+fr+gap+padding;
overflow).

**Remaining (2b):** `.rss` authoring — parse `display: grid` /
`grid-template-columns` / `grid-template-rows` in the style resolver so grid is
authorable from a stylesheet (today it is set via `UiNode` init).

## Phase 3 — placement + `auto`/`minmax` + alignment

Explicit placement (`grid-column` / `grid-row`) and spanning; `auto` and
`minmax()` tracks (using the child intrinsic-measure hook); grid-level
`justify-items` / `align-items` / `justify-content` / `align-content`.
