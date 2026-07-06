---
'@retro-engine/ui': minor
---

feat(ui): UiNode/ComputedLayout components + UiPlugin layout system (phase 1b)

Drives the flexbox engine from the ECS:

- `UiNode` — the authored `UiStyle`, reflection-registered so it round-trips
  through a saved scene (auto (`undefined`) dimensions and no-limit max-sizes are
  omitted on encode and restored on load). Auto-attaches `ComputedLayout`.
- `ComputedLayout` — the computed **absolute** (screen-space) box, written each
  pass; derived, deliberately not serialized.
- `UiPlugin` — inserts `UiViewport` (root available size) and `UiLayout` (the
  swappable engine), and runs a `postUpdate` `ui-layout` system that mirrors the
  `Parent`/`Children` hierarchy into a `LayoutNode` tree, computes it, and writes
  each entity's `ComputedLayout` with accumulated absolute coordinates.

A `UiNode` whose parent is not a `UiNode` (or has none) is a UI root sized
against the viewport. Verified on a bare ECS `World` (no renderer) plus a
reflection round-trip of every authored style field. Rendering the computed boxes
through the 2D pipeline is the next phase.
