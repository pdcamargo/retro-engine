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

## Phase 2b — `.rss` grid authoring ✅ (ADR-0167)

The style resolver maps `display: grid`, `grid-template-columns`, and
`grid-template-rows` (values kept as CSS strings, parsed at layout time), so grid
is authorable from a `.rss` stylesheet, not just `UiNode` init. Resolver
unit-tested; the engine half was already tested, so the `.rss` → grid layout chain
is covered end-to-end by composition. Grid is now **usable** (core + layout +
authoring).

## Phase 3 — placement + alignment + `auto`/`minmax`

- **Spanning + auto-placement ✅** — `placeGridItems` does CSS-style sparse
  auto-placement (occupancy grid; each item dropped at the first free top-left
  cell its `colSpan × rowSpan` block fits), `UiStyle` `gridColumnSpan`/
  `gridRowSpan`, `.rss` `grid-column`/`grid-row: span N`, wired into the layout
  engine. Unit-tested (spanning, wrapping, occupancy skip, gap in span, overflow).
- **Item alignment ✅** — `UiStyle` `justifyItems`/`justifySelf` (inline axis) +
  the existing `alignItems`/`alignSelf` reused for the block axis; a `placeInCell`
  helper sizes + offsets each item within its cell (`stretch` fills, else
  start/center/end at its definite-or-intrinsic size). `.rss` maps `justify-items`/
  `justify-self` (+ `align-*`) and normalizes CSS grid `start`/`end` to
  `flex-start`/`flex-end`. Layout + resolver unit-tested (center, end, per-item
  self override, mixed stretch/aligned axes).
- **Auto-rows ✅** — `UiStyle.gridAutoRows` (fixed px, default `0`) generates
  implicit rows so items past the explicit `grid-template-rows` flow into new rows
  instead of collapsing to zero size. The placement core was refactored around a
  shared `assignGridCells` (bounded → `placeGridItems`; unbounded → the new
  `gridRowCount`), and the layout engine grows the row template to `gridRowCount`
  before resolving geometry. `.rss` maps `grid-auto-rows`. Unit-tested (no-explicit-
  rows flow, fr + implicit-px interplay, span-aware row counting).
- **Explicit line placement ✅** — `UiStyle` `gridColumnStart`/`gridRowStart`
  (1-based lines, `0` = auto); a two-pass `assignGridCells` places explicit items
  (both axes set) first — reserving their cells (they may overlap, per CSS) — then
  auto-flows the rest around them. Explicit rows count toward `gridRowCount` so
  auto-rows hold them. `.rss` `grid-column`/`grid-row` parse the full CSS line
  syntax (`N / M`, `N / span M`, bare `N` = a line) via `gridLine` (a bare number
  is now correctly a line, not a span). Unit-tested (placement, clamp-to-width,
  auto-flow-around, line parsing).
- **Content distribution ✅** — `justify-content` (column axis) + the new
  `alignContent` (row axis) position the whole track block within the content box
  when the tracks don't fill it (`start`/`center`/`flex-end`, a leading offset
  applied to every cell via `contentOffset`). `.rss` maps `align-content`. The
  `space-*` modes (track-level spacing) fall back to start — a follow-up.
  Unit-tested (center both axes, flex-end both axes).
- **Remaining:** `auto` / `minmax()` tracks (needs the child intrinsic-measure
  hook); `space-between`/`around`/`evenly` track spacing; `grid-auto-flow: column`
  + implicit *column* tracks.
