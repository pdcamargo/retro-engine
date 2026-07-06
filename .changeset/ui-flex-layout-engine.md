---
'@retro-engine/ui': minor
---

feat(ui): new @retro-engine/ui package with a pure flexbox layout engine (phase 1a)

Introduces the in-game UI package with the layout foundation:

- `LayoutEngine` interface + `LayoutNode` / `LayoutResult` / `MeasureFunc` types.
- `FlexLayoutEngine` — a single-line CSS flexbox implementation: main-axis
  grow/shrink with min/max clamping and iterative freezing (CSS Flexible Box
  §9.7), `justify-content`, `align-items` / `align-self`, `gap`, padding, margin,
  and `position: absolute` insets. Pure TypeScript — no ECS, no GPU — with a
  text-measure callback hook.
- `UiStyle` + `makeStyle` (fully-defaulted style struct with edge shorthands).

ECS components (`UiNode` / `ComputedLayout`), the layout system, `.rss` styling,
rendering, and widgets land in later phases.
