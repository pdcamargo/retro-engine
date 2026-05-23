# Benchmarking

Retro Engine's microbenchmark suite runs against the ECS + engine hot paths
(`packages/ecs/bench/**` and `packages/engine/bench/**`). The renderer is not
yet in scope — see [ADR-0017](docs/adr/ADR-0017-benchmarking-infrastructure.md)
for the methodology, the rationale behind the 1.5× regression threshold, and
why CI gating is deferred to a later slice.

## Run the suite

```bash
bun run bench
```

Fans out via turbo to every in-scope package. Each package's `bench/index.ts`
prints a mitata summary table — avg, min, max, p75, p99, samples, and an ASCII
histogram per bench. Wall-clock runtime is roughly 20–30 seconds on a warm
laptop.

Scope a run with a regex filter (passed straight through to mitata):

```bash
cd packages/engine
bun run bench/index.ts --filter "propagateTransforms"
```

Emit the normalized JSON snapshot (the format the comparator reads):

```bash
bun run bench/index.ts --json
```

## Check for regressions

```bash
bun run bench:check
```

Captures the current numbers per package, diffs each bench against the
package's committed `bench/baseline.json` by name + parametrized args,
prints a single table, and exits:

- `0` — every bench is within 1.5× of baseline.
- `1` — at least one bench regressed beyond the threshold; the offending
  rows are flagged `REGRESS`.
- `2` — at least one bench is new (no baseline entry yet). Fix by capturing
  baselines (see below).

Override the threshold for a one-off run (a noisy environment, a deliberately
pessimistic gate during a perf-sensitive change):

```bash
BENCH_REGRESSION_THRESHOLD=2.0 bun run bench:check
```

The threshold must be a number greater than 1. The default is 1.5.

## Update the baselines

```bash
bun run bench:update
```

Runs the same capture as `bench:check` and overwrites every
`packages/*/bench/baseline.json` with the current numbers. Run this:

- The first time you clone the repo (baselines are committed for one
  machine's hardware; ratios are only meaningful against your own captured
  numbers).
- After landing an intentional perf improvement — commit the
  `baseline.json` diff alongside the code change so reviewers see the win.
- After adding, renaming, or removing benches.

Baselines are committed git-tracked artifacts. A PR that changes perf-sensitive
code is expected to include the baseline diff; reviewers approve the new
numbers as part of the review.

## Interpreting a regression failure

`bench:check`'s output lists every bench with `baseline`, `current`, and the
`Δ` ratio. A `REGRESS` row means the current `mean_ns` is more than the
threshold times the baseline `mean_ns`. The comparator does not diagnose the
cause — it points at the slow bench.

To investigate:

1. Re-run the failing bench in isolation with `--filter` to confirm the
   regression reproduces (microbench noise occasionally exceeds 1.5× on a
   single sample; running the bench alone tends to settle).
2. `git diff HEAD` against the package whose bench regressed. Most
   regressions correlate with a recent edit in the same package.
3. `git bisect` against `bun run bench:check` for older drift.
4. The `samples` field in `baseline.json` indicates how many iterations
   mitata gathered — low sample counts (under ~50) on a millisecond-class
   bench mean the timing has higher variance; consider whether the bench
   itself needs tightening.

For systemic perf investigation beyond what microbenches reveal, profiling
tooling (Tracy, chrome traces) is intentionally deferred. See ADR-0017's
"Accepted trade-offs" section.

## Adding a new bench

1. Add a `*.bench.ts` file under the relevant `packages/<pkg>/bench/`,
   one concern per file (CLAUDE.md §5.5). Follow the structure of an
   existing bench file: declare benches with `bench(name, function* (state)
   { yield () => /* hot path */ })` inside a `summary(() => { … })` block.
2. Import the new file from `packages/<pkg>/bench/index.ts`.
3. Run `bun run bench:update` to capture baselines.
4. Commit the bench file, the `index.ts` change, and the `baseline.json`
   diff together.
