---
'@retro-engine/ui': minor
---

feat(ui): grid explicit line placement (grid-column / grid-row lines)

Phase 3d of grid layout (ADR-0167). Grid items can now be placed at explicit grid
lines instead of only auto-flowing. `UiStyle` gains `gridColumnStart` /
`gridRowStart` (1-based lines, `0` = auto); when both are set the item is placed
at that cell and auto items flow around it. The placement core is a two-pass
`assignGridCells` (explicit items reserved first — they may overlap, per CSS —
then sparse auto-flow); explicit rows count toward `gridRowCount` so auto-rows can
hold them.

`.rss` `grid-column` / `grid-row` now parse the full CSS line syntax via a new
`gridLine` helper:

```css
.hero { grid-column: 1 / 3; grid-row: 2 / span 2; }  /* start line 1, span 2; start row 2, span 2 */
.side { grid-column: 3; }                              /* explicit line 3, span 1 */
```

**Behavior change:** a bare number (`grid-row: 3`) is now an explicit **line**
(span 1), matching CSS — previously it was misread as a span. Use `span N` for a
span. Layout + resolver unit-tested.
