# ECS ordering depth

Deepen intra-stage scheduling beyond ADR-0008's label-based `before`/`after`.
Promoted from the P1 "ECS ordering depth" roadmap item. Each phase is an
independent slice; ship one at a time, keep the gate green.

## Phase 1 — Batch registration + `.chain()` ✅ (ADR-0157)

`system(params, fn, options?)` spec helper + `App.addSystems(stage, specs, { chain })`.
Chaining orders by **system id** (internal `RegisteredSystem.afterIds`), so it
composes with any labels the systems already carry. Topo sort handles both label
and id edges through one pass. Unit + integration tested; topo-sort chain scaling
benched.

## Phase 2 — `SystemSet` + set-level config

A named set a system can be assigned to (`{ inSet: MySet }`), with set-level
`before`/`after`/`runIf` that apply to every member. Sets are the reusable,
cross-plugin ordering handle labels only approximate today. Decide: string-keyed
sets (cheap, matches labels) vs. typed set tokens (Bevy `SystemSet` enum). Likely
generalize the existing label mechanism so a system can belong to multiple sets.

## Phase 3 — Ambiguity detection

Report pairs of systems in the same stage that (a) access the same resource /
component with at least one write and (b) have no ordering edge between them —
i.e. their relative order is undefined and could matter. Needs per-param access
metadata (reads/writes which resource + component types) surfaced from the
`Param` protocol (ADR-0006). Emit as a dev-time diagnostic (opt-in), listing the
conflicting pair + the contended type. Non-fatal; an `ambiguousWith` escape hatch
silences intentional cases.

## Phase 4 — Exclusive systems (`&mut World`)

A system param granting exclusive `&mut World` access (run alone, no other param
resolution). Structural world edits (spawn/despawn/insert with immediate effect)
without going through `Commands`. Ordering: exclusive systems are apply points,
so they interact with command-flush timing — sequence carefully.

## Phase 5 — Explicit state-transition ordering

From `docs/backlog/explicit-state-transition-ordering.md`: let user systems order
relative to the `StateTransition` apply point within a stage, rather than relying
on stage placement. Ties into Phase 2 (a built-in `StateTransition` set).
