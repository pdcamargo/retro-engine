# ADR-0017: Microbenchmark Infrastructure for ECS + Engine Hot Paths

- **Status:** Accepted
- **Date:** 2026-05-23

## Context

M3 phase 5 (ADR-0016) sealed the full ECS surface — archetype storage, all
query filter shapes, component + resource change detection, hooks, observers,
messages, states, and `Changed<Transform>`-gated transform propagation. Every
future engine feature lands on top of these primitives, and any one of them is
also a candidate for performance regression as the schedule, dispatch, or
storage layers evolve. The repo has no perf gate today. Drift will not show up
in `bun run test`; it shows up later as visible jank in the studio or
playground, by which point root cause is several commits back.

Patrick wants `cargo bench`-style ergonomics on top of the existing Bun
workflow: a single root command runs the suite, a second command compares
against committed numbers, and a regression flips an exit code. The renderer
is intentionally out of scope — sprite rendering does not exist yet
(ADR-0003's HAL ships a pink-triangle proof and nothing else) and GPU perf
will be a separate slice that integrates timing instrumentation against a
real workload. Profiling integration (Tracy, `performance.mark`, an in-tree
TracingPlugin) is also deferred to that future GPU-perf slice — adding it
now would be design surface without a consumer.

Bun's own docs (`https://bun.com/docs/project/benchmarking`) recommend mitata
for microbenchmarks and `hyperfine` for CLIs. mitata's published comparison
table puts its measurement overhead at roughly 6× lower than tinybench
(which Vitest's `bench` mode wraps), and its `run()` returns a structured
`{ context, benchmarks: trial[] }` object — programmatic access is built in,
which removes the need to parse pretty-printed stdout.

## Decision

### 1. mitata as the bench framework

`mitata@^1.0.34` is added as a root dev dependency. Each `.bench.ts` file
declares benches with `bench(name, function* (state) { yield () => … })` and
groups them under `summary(() => { … })` for the same human-readable summary
output a `cargo bench` user expects. Parametrization uses the chained
`.args(name, values[])` builder.

**Rejected alternatives:**

- **tinybench / Vitest `bench`**: ~6× higher per-iteration overhead per
  mitata's own published comparison; Vitest's JSON reporter has been broken
  long enough to be unreliable for CI compare scripts.
- **benchmark.js**: effectively unmaintained, no built-in JSON output, op/sec
  model is awkward to compare across machines and runtimes.
- **Custom `performance.now()` loop**: reinvents JIT warm-up, batching, GC
  hinting, and statistical aggregation badly. Not worth the LOC.

### 2. Per-package `bench/` folders, one concern per file

Each in-scope workspace package owns a sibling `bench/` directory next to
`src/`:

- `packages/ecs/bench/{query, spawn-despawn, change-detection}.bench.ts`
- `packages/engine/bench/{propagation, commands, resource-change}.bench.ts`

Each package gets a `bench/index.ts` runner that imports every sibling
`.bench.ts` (which declare benches at module scope) and calls `await run()`.
The runner accepts `--json` for the normalized snapshot format and `--filter
<regex>` to scope a run during local iteration.

`packages/engine/bench/helpers.ts` holds a headless `Renderer` stub and a
silent `Logger` — the same scaffolding the engine's own tests already use.
Bench files reuse it so the bench surface costs match the test surface costs.

CLAUDE.md §5.5's one-concern-per-file rule applies inside `bench/` for the
same reason it does inside `src/`: a reader chasing a propagation regression
should not have to scroll past commands or resource-change benches to find
it. Splitting also means a `--filter` regex can target a single file's
concern without false positives across the suite.

Bench files are excluded from `tsconfig.build.json` (and from `dist/` by
construction — they are not under `src/`), but `tsconfig.json` includes
them so `tsc --noEmit` catches drift between bench files and the public
package surface they consume.

### 3. Normalized baseline JSON, one file per package

Each package commits `bench/baseline.json` in the following schema:

```jsonc
{
  "schema": 1,
  "package": "@retro-engine/ecs",
  "captured_at": "2026-05-23T...",
  "runtime": "bun@1.3.14",
  "benches": [
    { "key": "query iter $size entities (1 cmp)[size=1000]",
      "group": null,
      "args": { "size": 1000 },
      "mean_ns": 17030,
      "p99_ns": 25500,
      "samples": 39329 }
  ]
}
```

The schema is ours, not mitata's. The runner normalizes from `run()`'s
return value at capture time so a mitata version bump or output-format
change only touches one place (`packages/*/bench/index.ts`). `key` includes
the bench name and a deterministic `[arg=value,...]` suffix derived from
the parametrized run — this is the join key the comparator uses.

Per-package baselines avoid coupling packages through a single committed
file: a new in-scope package adds its own `bench/baseline.json` without
touching shared state, and an `engine`-only optimisation produces a single
package's diff in the commit.

### 4. Comparator at `scripts/bench-check.ts`, 1.5× regression threshold

`bun run bench:check` (root script) fans out per package: spawn
`bun run bench/index.ts --json`, parse the normalized report, join against
the committed baseline by `key`, compute `mean_ns / baseline_mean_ns`, and
fail with a regression table if any ratio exceeds the threshold.

Threshold default is **1.5×**. The default catches algorithmic regressions
(e.g. an O(n) → O(n²) accidental upgrade, a hot-path map allocation per
iteration, a propagation pass that drops gating) while tolerating typical
microbench noise on a warm laptop — empirical run-to-run variance on the
captured suite sits at roughly 0.95×–1.07× even with no code changes.
A tighter threshold (e.g. 1.25×) trips on this noise; a looser threshold
(2.0×+) lets real moderate regressions slip through. Override by setting
`BENCH_REGRESSION_THRESHOLD=<n>` for one-off tuning (e.g. a known-noisy CI
runner, or a deliberately-pessimistic gate during a perf-sensitive change).

Three exit codes:
- `0` — every bench within threshold.
- `1` — at least one bench regressed beyond threshold; the offending rows
  are printed.
- `2` — new bench(es) detected without baseline entries. Treated as a soft
  warning (not a regression) but still non-zero so a future CI gate notices.
  Fix by running `bun run bench:update`.

`bun run bench:update` runs the same capture and overwrites every
`baseline.json`. Use it after an intentional perf improvement, after adding
or renaming benches, and on every developer machine before the first
`bench:check` to seed local numbers.

### 5. Local-only v1, no CI gate

Baselines are committed laptop-local numbers (Apple M4 + bun 1.3.x in this
slice). They serve two roles:

1. **Pre-PR developer signal.** A developer captures baselines once, makes a
   change, runs `bench:check` against their own committed numbers. Same
   machine, same runtime → variance is small enough that the 1.5× gate is
   meaningful.
2. **Living perf documentation.** Anyone reading `bench/baseline.json` sees
   what the developer's machine measures for each hot path on the current
   `main`. Numbers are not authoritative — they are illustrative of orders
   of magnitude (microseconds vs milliseconds, gated vs full propagation).

CI does **not** run `bench:check` in v1. Runner variance (cold cache,
shared hosts, virtualised CPU) makes a single-threshold gate either flaky
or so wide that real regressions are invisible. The clean future direction
(when CI gating is justified) is per-runner baselines stored as CI
artifacts: the first run on `main` records the baseline, subsequent runs
compare against the artifact and update it on green. That design is
deliberately deferred; it is not load-bearing for catching regressions
pre-merge, which is what this slice solves.

## Consequences

**Easier:**

- Algorithmic regressions in the ECS or engine surface are visible before a
  PR merges. `bun run bench:check` is the same shape of pre-merge gate as
  `bun run test`, just measuring time instead of correctness.
- The baseline file doubles as living perf documentation: a contributor
  reading `packages/engine/bench/baseline.json` sees that gated idle-frame
  propagation is microseconds while full recompute over a 10k-node forest
  is milliseconds, without needing to run anything.
- Adding a bench for a new feature is one `.bench.ts` file plus a
  `bench/index.ts` import — no framework wiring, no runner glue.

**Harder:**

- Baselines drift between developer machines. The numbers in
  `bench/baseline.json` reflect one machine; a teammate cloning the repo
  will see ratios near 1× only after running `bun run bench:update` on
  their own machine. Documented in `BENCHMARKING.md`.
- Intentional perf improvements land with a `baseline.json` diff. The PR
  reviewer sees the change in numbers and approves it as part of the
  review. No separate "update baselines" PR cycle.
- The 1.5× threshold is a judgement call. Run-to-run noise on shared
  CI runners likely overruns it; that's why CI gating is deferred.

**Accepted trade-offs:**

- No profiling, only timing. A regression in `bench:check` says *where*
  (which bench rose) and *how much* (the ratio) but not *why* (which code
  path got slower). Diagnosis is a separate step: `git bisect`, manual
  instrumentation, or — when the GPU-perf slice lands — Tracy / chrome
  traces. The bench gate is the regression signal, not the perf debugger.
- Bench files reference this ADR in their module-doc header. CLAUDE.md §4
  forbids ADR references inside shipped code (`packages/*/src/**`); bench
  files live under `packages/*/bench/**` and are excluded from `dist/`,
  so they're consumer-internal — the ADR pointer is fair game.

## Implementation

- `package.json` (root) — `mitata` dev dep; scripts `bench`, `bench:check`,
  `bench:update`.
- `turbo.json` — `bench` task with `cache: false`, no outputs.
- `scripts/bench-check.ts` — comparator + updater. Threshold env var, three
  exit codes, normalized JSON read/write.
- `packages/ecs/package.json` and `packages/engine/package.json` — `bench`
  script per package.
- `packages/ecs/tsconfig.json` and `packages/engine/tsconfig.json` — include
  `bench/**/*.ts` so `tsc --noEmit` covers bench files.
- `packages/ecs/tsconfig.build.json` and `packages/engine/tsconfig.build.json`
  — explicit `bench` in `exclude` for defence-in-depth (the `src/**` include
  scope already excludes them).
- `packages/ecs/bench/{query, spawn-despawn, change-detection}.bench.ts`,
  `bench/index.ts`, `bench/baseline.json`.
- `packages/engine/bench/{propagation, commands, resource-change}.bench.ts`,
  `bench/helpers.ts`, `bench/index.ts`, `bench/baseline.json`.
- `BENCHMARKING.md` (repo root) — how to run, how to update baselines, how
  to interpret a regression.
