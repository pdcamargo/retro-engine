
## ✅ P1 — Diagnostics: windowed frame-time stats + 1%-low FPS (unit-verified)

- **New:** `@retro-engine/engine` + `@retro-engine/ui`. `DiagnosticsStore` gains `minFrameTimeMs` /
  `maxFrameTimeMs` / `avgFrameTimeMs` and `onePercentLowFps` (the standard "1% low" stutter metric = `1000 /
  p99` frame time), computed over a rolling window. New `FrameTimeWindow` (O(1) ring buffer, default 120
  frames ≈ 2s) + pure `frameTimeStats(samples)` (min/max/avg/p99, nearest-rank). `updateDiagnostics` pushes
  each real frame time + refreshes the fields. The UI overlay `formatDiagnostics` now shows `(low N)` once the
  window has samples: `FPS 60 (low 42)  16.7ms  ents 42  assets 12`.
- **Verified:** `frame-time-window.test.ts` (new, 7): stats min/max/avg, p99 on the slow tail (nearest-rank),
  tiny-window clamp, no-mutate; ring retain/evict/clear. `diagnostics.test.ts` (+2): a 100ms slow tail drags
  `onePercentLowFps` to ~10 (below the smoothed fps); zero-delta frame leaves the window untouched.
  `diagnostics-overlay.test.ts` (+1): overlay appends `(low N)`. 1445 engine+ui tests. Gates green:
  typecheck, lint (0/0), build. Bench: `diagnostics.bench.ts` (per-frame window push+sort, ~4µs/frame) — full
  engine bench suite green.
- **HOW to test:** add `DiagnosticsPlugin` + `DiagnosticsOverlayPlugin` → the overlay shows `FPS N (low M)`;
  a stutter drops the `(low M)` well below the average FPS. Read `Res(DiagnosticsStore).onePercentLowFps` /
  `.minFrameTimeMs` etc. directly for a perf probe.
- **NOTE:** No ADR (additive, follows the existing diagnostics pure-fn + store pattern). This was a new gap I
  appended (Diagnostics remaining was only the studio panel). Box unchecked.
- Roadmap: MASTER-ROADMAP "Diagnostics store" now notes windowed frame-time stats + 1%-low shipped.

---
