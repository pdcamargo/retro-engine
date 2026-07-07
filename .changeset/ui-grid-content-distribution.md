---
'@retro-engine/ui': minor
---

feat(ui): grid content distribution (justify-content / align-content)

Phase 3e of grid layout (ADR-0167). When a grid's tracks don't fill the container
(e.g. a fixed-cell board smaller than its box), the whole track block can now be
positioned: `justify-content` distributes it on the column axis, the new
`UiStyle.alignContent` on the row axis. `start` / `center` / `flex-end` are
supported (a leading offset applied to every cell):

```css
.board { display: grid; grid-template-columns: 40px 40px 40px;
         justify-content: center; align-content: center; }
```

`.rss` maps `align-content`. The `space-*` modes (track-level space distribution)
fall back to start for now — a follow-up. Layout + resolver unit-tested.
