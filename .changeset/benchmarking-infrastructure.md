---
---

chore: benchmarking infrastructure (mitata, per-package benches, regression gate) — ADR-0017

Adds `bun run bench`, `bun run bench:check`, and `bun run bench:update` at the
repo root. Each in-scope package (`@retro-engine/ecs`, `@retro-engine/engine`)
owns a `bench/` folder with one `.bench.ts` file per concern, a runner entry,
and a committed `bench/baseline.json` capturing laptop-local numbers. A
~150-line comparator at `scripts/bench-check.ts` diffs current numbers against
baselines and fails on a 1.5× regression (override via
`BENCH_REGRESSION_THRESHOLD`). mitata is the bench framework — Bun's own
recommendation, JIT-aware loop, structured `run()` return value the runner
normalizes into the committed JSON schema.

No `packages/*/src/**` changes — bench files live under `packages/*/bench/**`,
excluded from `dist/`. No CI gate ships in this slice; baselines are
developer-local pre-PR signal. See `BENCHMARKING.md` for the workflow and
ADR-0017 for the methodology.
