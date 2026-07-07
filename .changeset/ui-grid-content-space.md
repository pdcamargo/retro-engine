---
'@retro-engine/ui': minor
---

feat(ui): grid content distribution space-between / around / evenly

Completes grid content distribution (ADR-0167): `justify-content` /
`align-content` now honor the `space-between` / `space-around` / `space-evenly`
modes, not just `start` / `center` / `end`. When a grid's tracks don't fill the
container, the leftover is distributed as a uniformly-widened inter-track gap
(plus a leading offset for around / evenly):

```css
.toolbar { display: grid; grid-template-columns: 20px 20px 20px;
           justify-content: space-between; }
```

Implemented by folding all six modes into one `contentDistribution` helper that
returns a leading offset + an effective gap, reusing the existing gap/offset
placement path (no per-cell-index bookkeeping). Only bites when tracks don't fill
the container (fr tracks fill it → no-op). Unit-tested (space-between + evenly
spacing); start/center/end unchanged.
