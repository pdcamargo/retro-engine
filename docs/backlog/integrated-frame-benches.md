# Integrated frame benches with per-system cost attribution

- **Created:** 2026-05-25

## Context

The existing bench suite is structured around isolated micro-benches: one function, one synthetic scale, one number. `sortAndEmitSpriteBatches: 10k sprites = 1.4 ms`, `ColorMaterial2d.prepareBindGroup × 1000 = 264 µs`, `propagateTransforms forest-10k`, and so on. The CI `bench` gate runs them end-to-end (catches compile + runtime drift in bench files) and the local `bench:check` compares against committed baselines per ADR-0017.

This worked when each phase was about a single isolated subsystem landing. It does **not** answer the question "where is frame time going at N entities" — which is the question that matters when somebody runs the playground stress harness and sees 6 fps at 25k entities, or 70 fps at 4k entities when the hardware can do 120.

Two specific gaps:

1. **Bench renderer is a stub.** `makeRenderingBenchRenderer()` in `packages/engine/bench/helpers.ts` returns inert no-op handles. `drawIndexed`, `setBindGroup`, `setPipeline`, `writeBuffer` — all `() => {}`. CPU prep + queue cost is measured; command-encoder dispatch cost is not, and **the actual GPU driver per-draw overhead is invisible by definition** (no real adapter is bound). At ~1 000 individual `Mesh3d` draws per frame the per-draw cost dominates a real browser frame but is zero in the bench.

2. **No integrated frame bench at scale.** Every bench tests one function at one scale. The composite cost of running 12+ systems back-to-back in the actual render schedule (transform propagation, atlas-animation, atlas-sync, sprite-bounds, visibility, sprite-prepare, two material prepares, two material queues, sprite-queue, render-graph dispatch) is unmeasured. The `sortAndEmitSpriteBatches` bench at 10k tells you nothing about the *frame* at 10k sprites — it skips every other system the frame runs through.

Together these mean the bench gate proves "no individual function regressed," not "FPS is good." Two are not the same. The 4k → 70 fps and 25k → 6 fps stress observations are not captured anywhere in the bench numbers.

## Why deferred

- The team is still landing rendering features (Phase 8.8 just sealed). Adding perf-attribution infrastructure now would compete with feature work for review attention.
- Some of the design questions are non-trivial — e.g. how to time individual systems without polluting the measurement with the timing overhead itself; whether the headless bench renderer should grow real command-buffer simulation (counts + state-change detection) or stay an inert stub; whether to use mitata's `summary()` grouping for per-system breakdowns or a custom reporter.
- The most actionable next perf step is probably **batched mesh draws** (already deferred to "Phase 13" per ADR-0028 / ADR-0035), which would change the shape of the frame enough that any attribution scaffolding written today would need a re-pass. Doing the instrumentation after the structural change avoids throwaway work.
- A separate concern (in-engine per-frame perf HUD that ships in dev builds) is *related* but distinct work — it captures the cost on real GPUs against real workloads, which the bench can't simulate.

## Acceptance

A new bench file (likely `packages/engine/bench/frame.bench.ts` per ADR-0017 §"one concern per file") plus supporting infrastructure that:

1. **Builds a real `App` with the full plugin stack** (`SpritePlugin`, `MaterialPlugin(UnlitMaterial)`, `Material2dPlugin(ColorMaterial2d)`, transform propagation, visibility), spawns a fixture scene at multiple scales — at minimum `100 / 1_000 / 10_000` entities, ideally `25_000` too — and runs one full render schedule per iteration.

2. **Times each named system in the schedule individually** and reports a breakdown. The simplest shape: wrap each `addSystem` callback in a `performance.now()` pair (driven by an opt-in `app.profile = true` flag the engine respects) and emit per-system μs in the bench output. mitata's `summary()` can group the per-system numbers under one bench name. Per-system overhead at ~10 systems × 100 ns timing cost = ~1 µs / frame — negligible against multi-millisecond frame budgets.

3. **Counts draw calls and state changes in the bench renderer.** Extend `makeRenderingBenchRenderer` so the no-op `drawIndexed` / `setBindGroup` / `setPipeline` / `writeBuffer` *increment counters* rather than just returning. A frame bench then reports "frame at N entities = X ms CPU + Y draws + Z bind-group changes + W buffer writes." This catches dispatch-cost growth (the 2 000-draw signal the stress harness exposed) even though real GPU cost stays unmeasured.

4. **Includes the four `mode=stress` fixture shapes** (mesh3d-only, mesh2d-only, sprite-only, animated-sprite-only) at the scaling tiers, so a regression in any one path is locally attributable rather than smeared across a mixed scene.

5. **Reports a "first frame surprised me" smell test in `bench:check`** — if a previously-cheap system grows >2× its baseline at the same scale, surface it in the local pre-PR check. Not a hard fail (the gate stays generous per ADR-0017 §5), but a flagged line in the breakdown.

When the integrated bench exists, the natural follow-up backlog item is the in-engine perf HUD (real-time per-system + per-pass timing in the playground / studio, gated on a dev flag, using `RendererCapabilities.timestampQueries` when available). That can be a separate backlog entry — this one is bounded to bench infrastructure.

Concrete signal this is done: someone can run `bun --filter @retro-engine/engine bench --filter frame` and the output reads "at 10 000 entities: transform-propagation 1.2 ms, sprite-prepare 0.8 ms, material-3d-queue 3.4 ms, render-graph-dispatch 5.1 ms, total 11.2 ms CPU + 2 000 draws + 240 bind-group changes," and a reviewer looking at a perf-relevant PR can immediately see which system moved.
