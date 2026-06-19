# ADR-0087: Editor play-state (`SimState`)

- **Status:** Accepted
- **Date:** 2026-06-18

## Context

The studio had play/pause controls, but `playing`/`paused` were loose booleans on
the studio's UI state object, gating nothing in the engine and readable only by the
studio itself. To make play mode mean something — systems that run only while
playing, panels that reflect the real run state, a future world snapshot/restore on
stop — the run state needs to be a first-class, engine-backed state machine, not an
ad-hoc flag.

The engine already has a general-purpose state machinery (`initState`, `State<S>`,
`NextState<S>`, `inState`, the `StateTransition` phase). What was missing was the
play-mode state itself and a decision about where it lives.

## Decision

Introduce `SimState` (`Edit` / `Play` / `Paused`), registered through the engine's
existing state machinery via `initState(SimState, SimState.Edit)`. Systems gate on
it with `inState(SimState.Play)`; tooling reads the live value with `currentSimState`
and requests transitions with `requestSimState`.

`SimState` lives in **`@retro-engine/editor-sdk`**, not the runtime engine. "Edit"
is an editor concept — a shipped game has no edit mode — and the engine must stay
game-general (CLAUDE.md §5.3, §12). Building it on the engine's state primitives is
what makes it "engine-backed"; the editor-specific naming stays out of the engine
core. It is trivially relocatable if a runtime pause concept is later wanted in core.

The studio toolbar drives `SimState`; the studio's `state.playing`/`state.paused`
become per-frame mirrors synced from it, so panels that don't hold the `App`
(viewports, inspector) keep reading one source of truth.

**Deferred:** actually gating gameplay systems by `SimState`, and world
snapshot-on-Play / restore-on-Stop, are out of scope here — there is no user
gameplay code loaded in the studio yet. Tracked in `docs/roadmap/play-mode.md`.

## Consequences

- Play state is now a real state machine the engine drives through `StateTransition`,
  with `OnEnter`/`OnExit` hooks available for free when gating lands.
- The Systems panel shows the current `SimState` and can mark user systems as
  "runs in Play".
- A one-frame latency exists between a toolbar click and the mirror updating (the
  transition applies on the next frame's `StateTransition`) — imperceptible.
- Gameplay-gating policy and snapshot/restore remain unsolved and tracked; the state
  has no functional effect on the schedule until that work lands.

## Implementation

- `packages/editor-sdk/src/sim-state.ts` — `SimState`, `initSimState`, `currentSimState`, `requestSimState`
- `packages/editor-sdk/src/index.ts` — re-exports
- `apps/studio/src/main.ts` — `initSimState(app)`, mirror sync in the draw callback
- `apps/studio/src/chrome.ts` — toolbar Play/Pause/Stop drive `SimState`
