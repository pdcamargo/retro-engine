---
'@retro-engine/engine': minor
'@retro-engine/ui': patch
---

feat(engine): windowed frame-time stats + 1%-low FPS in diagnostics

`DiagnosticsStore` now tracks a rolling window of recent frame times and exposes
`minFrameTimeMs` / `maxFrameTimeMs` / `avgFrameTimeMs` and `onePercentLowFps` —
the standard "1% low" stutter metric (`1000 / p99` frame time) — alongside the
existing smoothed FPS. Backed by a new `FrameTimeWindow` (O(1) ring buffer,
default 120 frames ≈ 2s) + a pure `frameTimeStats(samples)`.

`@retro-engine/ui`'s diagnostics overlay `formatDiagnostics` appends the readout
once the window has samples, e.g. `FPS 60 (low 42)  16.7ms  ents 42  assets 12`.
Unit-tested + benched (the per-frame window sort).
