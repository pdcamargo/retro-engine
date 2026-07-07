---
'@retro-engine/ui': minor
---

feat(ui): grid item alignment (justify/align items + self)

Phase 3b of grid layout (ADR-0167). Grid items can now be aligned within their
cell instead of always stretching to fill it. `UiStyle` gains `justifyItems` /
`justifySelf` (inline / horizontal axis); the existing `alignItems` / `alignSelf`
now also drive the block / vertical axis for grid. Values `flex-start` /
`center` / `flex-end` / `stretch` (default), with per-item `*-self` overriding the
container default:

```css
.grid { display: grid; justify-items: center; align-items: center; }
.hero { justify-self: end; align-self: stretch; }
```

A non-`stretch` axis places the item at its definite (or intrinsic) size at the
start / middle / end of the cell; `stretch` fills the cell as before, so existing
grids are unchanged. `.rss` authoring maps `justify-items` / `justify-self` (plus
`align-items` / `align-self`) and normalizes the CSS grid keywords `start` / `end`
to the engine's `flex-start` / `flex-end`. Layout + resolver unit-tested.
