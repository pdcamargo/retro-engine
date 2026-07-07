# ADR-0158: System sets and set-level ordering

- **Status:** Accepted
- **Date:** 2026-07-06
- **Extends:** ADR-0008 (label-based ordering), ADR-0157 (batch registration / chaining) — both sealed

## Context

ADR-0008 gave every system at most one `label` and edges keyed by label
(`after: ['physics']` = "after every system labelled `physics`"). That is enough
to name a single phase, but it falls short in two recurring ways:

1. **A system belongs to only one label.** A system that is both "gameplay" and
   "runs in the physics step" cannot say so.
2. **Group ordering must be repeated per member.** To make five systems all run
   after input, each of the five repeats `after: ['input']`. There is no place to
   say "the whole `physics` group runs after input" once.

Bevy's answer is `SystemSet`: a named set a system can join (several at a time),
with set-level configuration (`configure_sets(... .after(...))`) that applies to
every member. This is Phase 2 of the "ECS ordering depth" roadmap item;
ADR-0157's chaining handled the per-batch-sequence case.

## Decision

Add **named sets** as a reusable, multi-membership ordering handle, layered on
the existing topo sort — no second sort, no per-frame cost.

- **Membership.** `AddSystemOptions.inSet?: string | readonly string[]` — the
  set(s) a system joins. Stored on `RegisteredSystem.sets`. Stage-local, like
  labels; a system may join any number of sets and still carry its own `label`.

- **A "name" unifies labels and sets in the topo sort.** `topoSort` builds one
  `byName` index from each system's `label` *and* each of its set memberships.
  Consequently a per-system `before` / `after` target now matches **either** a
  label or a set name — `after: ['physics']` means "after every member of the
  `physics` set" as naturally as it meant "after every `physics`-labelled
  system." Labels are, in effect, single-membership sets; this generalization is
  backward-compatible (an existing label still matches).

- **Set-level ordering: `App.configureSet(stage, set, { before, after })`.** The
  `before` / `after` names target other sets or labels in the same stage; the
  constraint is expanded onto **every member** of the configured set at sort
  time. One declaration orders a whole group. Repeated calls for the same set
  merge additively. Set config lives on the stage's `StageSystems` (a
  `Map<setName, SetOrdering>`), fed into every `topoSort`, so it composes with
  membership registered before *or* after the config (forward references resolve
  on the next sort, matching label semantics).

- **Cycles.** `configureSet` re-sorts eagerly and, on a cycle, rolls the merge
  back before re-throwing — the same locality guarantee `addSystem` gives, so a
  set-vs-set cycle (`a after b`, `b after a`) is reported at the offending
  `configureSet` call.

- **What is deferred.** Set-level `runIf` (gating a whole group) is *not* in this
  slice: it touches the per-frame `runStage` gate (higher blast radius) and is
  cleanly separable. It is a tracked follow-up in the roadmap. This ADR is
  ordering-only, which keeps the change entirely at registration time — zero
  per-frame hot-path change.

- **Tooling.** `SystemInfo.sets` surfaces membership in `describeSchedule` for the
  studio Systems panel, alongside the existing `label`.

## Consequences

- `configureSet('update', 'physics', { after: ['input'] })` orders every physics
  member after input with one line; adding a sixth physics system needs no repeat
  of the constraint.
- `before` / `after` gained reach (set names) with no API change and no
  behavioral change for existing label users — a strict superset.
- Ordering still resolves in a single Kahn pass over label + set + id edges;
  `describeSchedule`, cycle reporting, and hot-swap removal are unaffected.
- Set-level `runIf` and typed (non-string) set tokens remain open; string-keyed
  sets were chosen to match the existing label mechanism and keep the reflection /
  wire story unchanged (sets are authoring-time ordering, not serialized state).

## Implementation

- `packages/engine/src/schedule.ts` — `RegisteredSystem.sets`; the `SetOrdering`
  type; `StageSystems.configureSet` (+ per-stage set-ordering map fed into
  `topoSort`); `topoSort` `byName` index + set-edge expansion.
- `packages/engine/src/index.ts` — `AddSystemOptions.inSet`; `App.configureSet`;
  `sets` threaded through `registerSystem` and `toSystemInfo`; `SetOrdering`
  re-exported.
- `packages/engine/src/schedule-info.ts` — `SystemInfo.sets`.
