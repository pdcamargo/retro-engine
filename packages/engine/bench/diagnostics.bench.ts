// Diagnostics update — per-frame frame-time window push + min/max/avg/p99 sort
// over the rolling window (the `last`-stage diagnostics system's hot cost). See
// docs/adr/ADR-0017.

import { bench, summary } from 'mitata';

import { DiagnosticsStore, updateDiagnostics } from '@retro-engine/engine';

summary(() => {
  // A steady stream so the window stays full (worst case: every frame sorts a
  // full 120-sample window).
  bench('updateDiagnostics: 10k frames (full 120-frame window)', function* () {
    yield () => {
      const store = new DiagnosticsStore();
      for (let i = 0; i < 10_000; i += 1) {
        // Vary the delta so the sort does real work, not an already-sorted run.
        updateDiagnostics(store, 0.016 + (i % 7) * 0.001, 100);
      }
      return store.onePercentLowFps;
    };
  });
});
