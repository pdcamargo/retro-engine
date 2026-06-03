# Explicit ordering for state-transition systems

- **Created:** 2026-06-03

## Context

State-transition systems (`OnEnter` / `OnExit` / `OnTransition`) run in **registration order** only — `StateSystemRecord` carries `runIf` but no `before`/`after`, unlike the main schedule. ADR-0062's scene teardown relies on this: `App.addScene` appends its despawn as an `OnExit` system, so the locked order (user `OnExit` → scene despawn → state-scoped resource removal) holds only for user `OnExit` systems registered *before* the `addScene` call.

## Why deferred

It works correctly today via registration order and no consumer yet needs a hard guarantee independent of registration order. The proper fix is a state-scheduler change — give transition systems the same `label` / `before` / `after` ordering primitive the main schedule has (or a framework "teardown runs last" slot) — which is its own slice with its own tests, not a tack-on to the scenes work. Touches `packages/engine/src/state.ts` (`StateSystemRecord`, `runRecords`) and the `App.onEnter/onExit/onTransition` surface.

## Acceptance

- Transition systems support explicit intra-phase ordering (before/after or an equivalent), validated like `addSystem`'s ordering (cycle detection, clear errors).
- Scene teardown is guaranteed to run after user `OnExit` systems regardless of registration order.
- ADR-0062's registration-order caveat is superseded by the new guarantee (note it where relevant).
