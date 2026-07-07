---
'@retro-engine/ui': minor
---

feat(ui): grid auto (content-sized) tracks — grid is now feature-complete

Final piece of grid track sizing (ADR-0167): `auto` tracks size to their content.
`grid-template-columns: auto 1fr` makes the first column shrink to its items'
intrinsic width while `1fr` takes the rest. Because placement only needs track
*counts*, the layout engine places items first, measures each `auto` track's
single-span items (via the existing intrinsic-measure), substitutes the track to
that pixel size, then resolves `fr` over the remainder — reusing the tested
placement/geometry primitives (a new exported `assignGridCells` exposes the
assignments). The path is gated on the presence of an `auto` track, so grids
without one are unchanged.

With this, CSS Grid covers the full common feature set: `px`/`fr`/`auto`/`minmax`
tracks, spanning, explicit line placement, implicit auto-rows/columns, row/column
auto-flow, item alignment, and content distribution. (Multi-span `auto`
contributions are a documented follow-up.) Unit + end-to-end tested.
