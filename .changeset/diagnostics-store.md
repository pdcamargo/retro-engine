---
'@retro-engine/engine': minor
'@retro-engine/ecs': minor
---

feat(engine): diagnostics store — FPS / frame-time / entity-count

Adds the P1 diagnostics store: a live source for an FPS / frame-time overlay or a
headless perf probe.

- `@retro-engine/ecs`: `World.entityCount` — the live entity count in O(1) (from
  the internal entity index), so a per-frame reader needn't materialize
  `entities()`.
- `@retro-engine/engine`: `DiagnosticsStore` resource (`frameTimeMs` EMA-smoothed,
  derived `fps`, `entityCount`, `frameCount`), the pure `updateDiagnostics(store,
  realDeltaSeconds, entityCount)` fold, and an opt-in `DiagnosticsPlugin` that
  inserts the store and updates it each frame from the **real** clock delta
  (wall-clock cost, not paused/scaled gameplay time) in a `'last'`-stage system.

Opt-in and inert until added. Unit-tested (smoothing convergence, first-sample
seed, zero-delta handling) + an integration test driving `advanceFrame` (frame
count, live entity count, non-zero fps).
