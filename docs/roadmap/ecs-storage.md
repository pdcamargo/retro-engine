# ECS Storage (perf + ergonomics beyond M2 baseline)

- **Created:** 2026-05-21
- **Status:** Future direction (sketch — M2 ships the baseline)

## Goal

The M2 backlog item `docs/backlog/ecs-archetype-world.md` ships real archetype storage: archetype graph, column storage, multi-component queries, Required Components, the `Disabled` marker, per-column generation counters for future change detection. That's the **baseline** — enough to build sprites, hierarchy, scenes, UI on top.

This roadmap captures everything *beyond* the baseline. The ECS hot path matters as the engine scales, but optimizing it before a real consumer exists is premature work. Items here promote into backlog when a measurement justifies them or a feature requires them.

## Phases

Each phase is a sketch. Promote when a benchmark or feature actually pulls on it.

1. **Sparse-set sidecar storage** — archetype storage is cache-friendly for steady-state iteration but pays per structural change. For high-churn data (editor-time component churn, debug tags, runtime-toggled flags) a sparse-set per-component sidecar can be cheaper. ADR-0005's "Consequences" anticipated this; this phase makes it real if/when editor metadata demands it.
2. **Archetype-graph fragmentation under thousands of signatures** — large archetype counts (>1k unique signatures) is Bevy's documented pain point. Mitigations: archetype interning, archetype eviction, signature canonicalization. Only worth doing if a real game project hits it.
3. **Real benchmarks** — harness with golden numbers committed; CI weekly (separate workflow, not blocking). ADR-0005 set the target: 10k-entity 3-component iteration within 4× of a hand-written loop over typed arrays. Until the benchmark exists, the target is aspirational.
4. **Typed-array column storage** — components stored as `Float32Array` / `Int32Array` / `Uint32Array` per field where the field type allows (struct-of-arrays). Cache-friendlier than object arrays; requires reflection metadata or explicit per-component packing rules. Tied to `docs/roadmap/reflection-and-serialization.md`.
5. **Component change-detection-via-generation** — design lives in `docs/roadmap/change-detection.md`; impl reuses the per-column tick counters M2 baked in.
6. **Archetype-level dirty bits** — optimization for sparse `Changed<T>` iteration. Skip whole archetypes when their tick is older than the system's last-seen tick. Bevy's standard trick.
7. **Component deletion strategy** — swap-remove (fast, reorders entities within archetype) vs stable remove (slow, preserves insertion order). M2 baseline uses swap-remove; this phase makes the choice configurable per-component if a use case demands stable order.
8. **Worker-thread evaluation** — explicitly: **no**. TypeScript's worker model can't share component memory without `SharedArrayBuffer` + COOP/COEP headers, neither of which fits the archetype-iteration pattern. Documented here so the question doesn't keep coming up.

## Open questions

- **What triggers promotion of phase 1 (sparse-set sidecar)?** Probably: editor live-update churn on debug components, or a profile showing archetype transitions dominating a frame. No clear signal yet.
- **Are typed-array columns worth the reflection coupling?** Microbenchmarks would help; defer until reflection lands.
- **Stable-remove use cases.** Z-ordering by spawn order is the obvious one but Z-order is usually explicit anyway. Probably not worth the cost.

## Links

- M2 baseline: `docs/backlog/ecs-archetype-world.md`
- ADR-0005 (chose archetype storage; this roadmap is its post-M2 perf + ergonomics tail)
- Related: `docs/roadmap/change-detection.md`, `docs/roadmap/reflection-and-serialization.md`
- External:
  - Bevy hybrid table + sparse-set storage ([bevy_ecs docs](https://docs.rs/bevy_ecs/latest/bevy_ecs/))
  - Bevy archetype iteration design ([bevy-cheatbook](https://bevy-cheatbook.github.io/programming/ecs-intro.html))
  - Flecs storage manual (architectural reference): https://www.flecs.dev/flecs/md_docs_2Manual.html
