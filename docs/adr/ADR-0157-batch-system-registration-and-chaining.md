# ADR-0157: Batch system registration and `.chain()` ordering

- **Status:** Accepted
- **Date:** 2026-07-06
- **Extends:** ADR-0008 (schedule + label-based `before`/`after` ordering — sealed)

## Context

ADR-0008 shipped intra-stage ordering as **label-based** `before` / `after`
constraints resolved by a Kahn topological sort. A system carries at most one
`label`, and an edge is expressed against a label ("run after every system
labelled `physics`"). That is the right primitive for coarse, named phases, but
it is awkward for the single most common ordering need: **"run this handful of
systems in exactly this sequence."**

Expressing a strict sequence today means inventing a label per step and threading
`after: ['prev-label']` by hand — verbose, and it collides with the fact that a
system's one `label` slot may already be spoken for by a coarse phase name. Bevy
solves this with `add_systems(Update, (a, b, c).chain())`: a **tuple of systems
registered together**, with `.chain()` wiring each to run after the previous by
**system identity**, independent of any labels they also carry.

Retro Engine needs the equivalent. The gap is two-fold: there is no batch
registration entry point (each `addSystem` is a separate call), and ordering
edges can only be keyed by label, not by a specific system instance.

## Decision

Add **batch registration** with an opt-in **chain** that orders by system id.

- **`system(params, fn, options?)`** — a small helper that captures a single
  system's `params` tuple, its typed `fn`, and optional per-system
  `AddSystemOptions`, returning an opaque `SystemSpec`. It exists so each spec in
  a batch keeps full per-system param-type inference (each has its own param
  tuple); it does not register anything on its own.

- **`App.addSystems(stage, specs, options?)`** — registers every `SystemSpec` in
  order against `stage`, applying the same param-scope and render-`set`
  validation `addSystem` does, and returns `this`. Registration order is the
  batch order, so unconstrained systems keep their intuitive left-to-right
  tie-break. `options.chain` (default `false`) makes each system after the first
  **run after the previous system in the batch**.

- **Instance-level ordering edges.** A `RegisteredSystem` gains an internal
  `afterIds?: readonly SystemId[]` — ordering edges keyed by **system id**, not
  label. `topoSort` adds an edge `src → this` for each present `afterIds` entry,
  alongside the existing label edges. `.chain()` is the only producer today: it
  sets each chained system's `afterIds` to the previous system's id. Id edges are
  **not** part of the public `AddSystemOptions` — chaining is expressed through
  `addSystems(..., { chain: true })`, and the ids stay an internal detail.

- **Why id edges, not synthetic labels.** A system already carries at most one
  `label`, often a meaningful phase name. Chaining by injecting a hidden label
  would either clobber that slot or force multi-label support. Keying the chain
  edge on the system's own id sidesteps both: chaining composes freely with a
  system that also carries a user `label` and its own `before`/`after`.

- **Cycles.** Chain edges flow strictly from earlier to later batch members, so a
  chain alone cannot form a cycle. A chain combined with a conflicting label
  constraint still can, and is caught by the same eager Kahn check in
  `StageSystems.push` (registration rolls back and throws, naming the cycle) —
  unchanged from ADR-0008.

## Consequences

- `app.addSystems('update', [system([...], a), system([...], b)], { chain: true })`
  makes `a` run before `b` with no invented labels and no dependence on either
  system's existing label — the ergonomic Bevy authors expect.
- Ordering now has two edge kinds (label and id); both feed one topo sort, so
  `describeSchedule`, cycle reporting, hot-swap removal, and the run-condition
  gate all keep working with no special-casing.
- `addSystems` without `chain` is just a grouping convenience (same result as N
  `addSystem` calls) — useful for readability and for a future group-level
  `runIf` / `before` / `after` (tracked, not in this slice).
- The id-edge field is additive and internal; existing schedules and the wire
  format are untouched. This is the first slice of the "ECS ordering depth"
  roadmap item; `SystemSet`, set-level run-conditions, ambiguity detection, and
  exclusive (`&mut World`) systems remain tracked follow-ups.

## Implementation

- `packages/engine/src/schedule.ts` — `RegisteredSystem.afterIds`; `topoSort`
  builds a `byId` map and adds id-keyed edges.
- `packages/engine/src/index.ts` — `SystemSpec`, `AddSystemsOptions`, the
  `system()` helper, `App.addSystems()`; `addSystem` refactored to share a
  private entry-builder that returns the new `SystemId`. `system` re-exported.
