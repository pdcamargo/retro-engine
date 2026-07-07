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

## Phase 2 — `SystemSet` + set-level ordering ✅ (ADR-0158)

Named, multi-membership sets: `{ inSet: 'physics' }` (or `['a','b']`) +
`App.configureSet(stage, set, { before, after })`. The topo sort now indexes each
system by its `label` **and** its set memberships under one `byName` map, so
`before`/`after` targets match set names too, and set-level config expands onto
every member. String-keyed (matches labels); registration-time only, so zero
per-frame cost. `SystemInfo.sets` surfaces membership for tooling. Unit tested;
set-edge topo scaling benched.

## Phase 2b — set-level `runIf` ✅ (ADR-0158)

`App.configureSet(stage, set, { runIf })` gates a whole group: a member runs only
when its own `runIf` and every set it belongs to pass (multiple conditions on one
set AND-ed). Checked through a shared `StageSystems.setConditionsPass(sys, app)`
called from both runners (`runStage` and the render `runRenderSet`), so the gate
is applied everywhere with no half-coverage; alloc-free on the hot path. Unit
tested.

## Phase 3 — Ambiguity detection

Report pairs of systems in the same stage that (a) access the same resource /
component with at least one write and (b) have no ordering edge between them —
i.e. their relative order is undefined and could matter. Needs per-param access
metadata (reads/writes which resource + component types) surfaced from the
`Param` protocol (ADR-0006). Emit as a dev-time diagnostic (opt-in), listing the
conflicting pair + the contended type. Non-fatal; an `ambiguousWith` escape hatch
silences intentional cases.

## Phase 4 — Exclusive systems (`&mut World`) ✅ (ADR-0160)

`world(): Param<World>` resolves to the stage's live `World` for immediate
structural edits (spawn/despawn/insert/remove) with same-frame read-back, no
`Commands` deferral. Guardrail: a system with `world()` must declare no other
param (the `Param.exclusive` flag, validated at registration). Lowercase factory
matches `key`/`gamepadAxis` and avoids the `World`-class collision. Single-thread
runner needs no scheduling change; the flag is the seam a parallel scheduler would
read. Unit tested (immediate spawn seen by a later system; despawn/mutate; mixed-
param rejection).

## Phase 5 — Explicit state-transition ordering 🟡 (ADR-0161)

**Done (5a):** `onEnter`/`onExit`/`onTransition` accept `label`/`before`/`after`
(`StateSystemOptions`), ordered by the same (now-generic) `topoSort` as the main
schedule, with eager cycle detection. Purely additive — unconstrained transition
systems keep registration order. Unit tested.

**Remaining (5b):** the backlog item's teardown-last guarantee — `App.addScene`'s
despawn `OnExit` must run after **all** user `OnExit` regardless of registration
order (ADR-0062 caveat). Needs a framework-vs-user phase split or a reserved
"runs last" slot. `docs/backlog/explicit-state-transition-ordering.md` stays open
until this lands.
