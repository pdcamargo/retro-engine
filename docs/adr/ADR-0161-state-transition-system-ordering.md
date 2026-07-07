# ADR-0161: Explicit ordering for state-transition systems

- **Status:** Accepted
- **Date:** 2026-07-06
- **Extends:** ADR-0008 (schedule + states), ADR-0157/0158 (topo ordering) — sealed

## Context

`OnEnter` / `OnExit` / `OnTransition` systems ran in **registration order** only.
`StateSystemRecord` carried a `runIf` gate but none of the `label` / `before` /
`after` ordering the main schedule has (ADR-0008 §4). So two `OnEnter` systems
for the same state could only be ordered by registering them in the right order —
brittle, and impossible across plugin boundaries. This is the ordering half of
the `explicit-state-transition-ordering` backlog item.

The main schedule already solved intra-phase ordering with a Kahn topological
sort over `label` / `before` / `after` edges (ADR-0008), later generalized to set
names and id edges (ADR-0157/0158). Transition records are a different struct but
carry a unique `id`, so the same sort applies — the only thing missing was the
ordering fields and a place to run the sort.

## Decision

Give transition systems the **same ordering primitive** as stage systems, by
reusing the existing topo sort.

- **`topoSort` is now generic** over an `OrderableSystem` shape
  (`{ id; label?; before?; after?; afterIds?; sets? }`). `RegisteredSystem`
  already satisfies it; `StateSystemRecord` now does too. One implementation
  orders both — no duplicated Kahn's algorithm. It takes an optional error-context
  string so a cycle in a transition phase reports as such, not as `App.addSystem`.
- **`StateSystemOptions`** — the options bag for `onEnter` / `onExit` /
  `onTransition` gains `label` / `before` / `after` alongside the existing
  `runIf`, mirroring `AddSystemOptions`. `before` / `after` target labels of other
  systems **in the same transition phase** (the same `OnEnter(value)` list, etc.);
  they do not cross phases, exactly as stage labels do not cross stages.
- **Eager cycle detection.** Each registration appends the record and re-runs the
  topo sort over that phase's list; a cycle rolls the record back and throws at
  the `onEnter`/`onExit`/`onTransition` call site — the same locality guarantee
  `App.addSystem` gives.
- **Ordering is applied at run time.** `runRecords` topo-sorts the phase's records
  before invoking them (registration order remains the tie-break, so unconstrained
  systems are unchanged). Transitions fire only on an actual state change over
  small lists, so the per-transition sort is negligible and needs no cache.

**Purely additive.** A transition system with no `label`/`before`/`after` behaves
exactly as before (registration order). Nothing about the existing
`OnExit → remove-scoped → OnTransition → OnEnter` phase sequence, or scene
teardown timing, changes.

## Consequences

- Two `OnEnter(Playing)` systems can now be ordered independently of registration
  (`{ label }` + `{ after: [...] }`), including across plugins.
- Reusing one generic `topoSort` keeps ordering semantics (edges, tie-break, cycle
  errors) identical between the main schedule and transition phases.
- **Not yet addressed:** the backlog item's second half — *guaranteeing* scene
  teardown (`App.addScene`'s despawn `OnExit`) runs after **all** user `OnExit`
  systems regardless of registration order (ADR-0062's caveat). That needs a
  framework-vs-user phase split (or a reserved "runs last" slot) and is a separate
  slice; the backlog file stays open until it lands. Users can already order their
  own `OnExit` relative to a known label today.

## Implementation

- `packages/engine/src/schedule.ts` — `OrderableSystem`; `topoSort` made generic
  with an error-context param.
- `packages/engine/src/state.ts` — `StateSystemOptions`; `label`/`before`/`after`
  on `StateSystemRecord`; eager cycle check on add (`pushOrdered`); `runRecords`
  topo-sorts before running.
- `packages/engine/src/index.ts` — `onEnter`/`onExit`/`onTransition` accept
  `StateSystemOptions`; the type is re-exported.
