---
'@retro-engine/ui': minor
---

feat(ui): grid minmax(px, fr) track sizing

Phase 3h of grid layout (ADR-0167). Grid tracks can now be `minmax(<px>, <px|fr>)`
— a track sized at least the given pixel floor. `minmax(120px, 1fr)` grows like a
`1fr` track but never shrinks below `120px` (the CSS floored-`fr` algorithm:
tracks whose fair share would starve are frozen at their min and the rest
re-split); `minmax(px, px)` takes its min. Authored via the existing template
strings — no new style fields:

```css
.responsive { display: grid; grid-template-columns: minmax(120px, 1fr) 1fr; }
```

`parseGridTemplate` keeps `minmax(...)` whole (even with the inner comma space)
and `resolveGridTracks` runs the iterative floor resolution; plain `px` / `fr`
behavior is unchanged. Content-sized `auto` tracks remain a follow-up (they need
child intrinsic measurement). Unit-tested + end-to-end layout test.
