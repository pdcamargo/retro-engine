# Engine Schedule and States

- **Created:** 2026-05-21

## Context

Today's `App` runs five stages per tick — `startup`, `preUpdate`, `update`, `postUpdate`, `render` — with systems executing in registration order within each stage and no concept of run conditions, scene state, or fixed timestep. This is undersized for anything past the triangle. Real gameplay needs:

- **Scoped systems and resources**: a system that runs only while `GameState === Playing`; a resource that exists only between `OnEnter(Loading)` and `OnExit(Loading)`.
- **Ordering within a stage**: "input parsing runs before movement, movement runs before collision."
- **A fixed sub-loop** for physics-shaped logic that must be deterministic regardless of frame rate.
- **State transition hooks** so plugins can spawn / tear down entities and resources cleanly when the active scene or mode changes.

This backlog item lands all of that as one piece because the schedule + states + run conditions interlock. Splitting them produces a half-built scheduler that can't be tested.

### Schedule structure

Adopted from Bevy 0.17 (scoped down — single-threaded, no parallel executor):

```
Main per-frame:
  First → Startup → PreUpdate → StateTransition → RunFixedMainLoop → Update → PostUpdate → Last → Render

FixedMain (runs N times inside RunFixedMainLoop, accumulator-based):
  FixedFirst → FixedPreUpdate → FixedUpdate → FixedPostUpdate → FixedLast

State schedules (run during Main.StateTransition when a transition occurs):
  OnExit(S_old) → OnTransition(S_old → S_new) → OnEnter(S_new)
```

Render stays as a terminal stage in Main; the M1 render-pass plumbing is preserved.

### States + run conditions

```ts
// Approximate surface.
enum GameState { Boot, MainMenu, Loading, Playing, Paused }

app.initState<GameState>(GameState.Boot);
app.onEnter(GameState.Loading, [/* params */], (commands) => { /* spawn loading screen */ });
app.onExit(GameState.Loading,  [/* params */], (commands) => { /* tear down */ });

app.addSystem('update', [/* params */], movePlayer,
              { runIf: inState(GameState.Playing) });

app.addSystem('update', [/* params */], pulseMenuButtons,
              { runIf: inState(GameState.MainMenu).and(resourceExists(MenuTheme)) });

// Transition by mutating NextState resource.
app.addSystem('update', [ResMut(NextState<GameState>)], (next) => {
  if (someCondition) next.set(GameState.Playing);
});
```

Built-in run conditions: `inState(S)`, `resourceExists(ctor)`, `resourceChanged(ctor)`, `anyWithComponent(ctor)`. Custom conditions are param-shaped functions returning `boolean`, composable with `.and(...)` / `.or(...)` / `.not()`.

### State-scoped resources

Bevy delegates this to a community crate; we make it first-class:

```ts
app.insertStateScopedResource(GameState.Playing, new ScoreTracker());
// inserted on OnEnter(Playing), removed on OnExit(Playing).
```

Cleanup semantics (does `OnExit` run before resource removal, or after?) is an execution-time decision recorded in the ADR for this work.

### Ordering within a stage

Labels + `before` / `after` constraints, no parallel scheduling:

```ts
app.addSystem('update', params, readInput,    { label: 'input' });
app.addSystem('update', params, applyMotion,  { after: ['input'], label: 'motion' });
app.addSystem('update', params, resolveColl,  { after: ['motion'] });
```

Single-threaded execution — ordering is the win, not parallel safety.

### Fixed timestep

`Time<Fixed>` is the accumulator resource. Default 60 Hz (configurable). `RunFixedMainLoop` runs `FixedMain` zero or more times per frame depending on accumulated delta. Render-side interpolation between fixed steps is out of scope here.

## Why deferred

M2 phase 5. Depends on the resource registry (phase 2 — `NextState<S>`, state-scoped resources, `Time<Fixed>` all live there) and the system param protocol (phase 1 — run conditions and `NextState` are params). Standalone from phase 4 (archetype world); the two can develop independently and converge for integration testing.

## Acceptance

- `App` runs the full Main schedule order each frame: `First → Startup (first frame only) → PreUpdate → StateTransition → RunFixedMainLoop → Update → PostUpdate → Last → Render`.
- `initState(S)` registers a state enum; `NextState<S>` resource is auto-inserted; mutating it schedules a transition.
- `OnExit(old) → OnTransition(old → new) → OnEnter(new)` schedules run in order during `StateTransition`.
- `runIf(inState(S))` excludes a system while the active state ≠ S.
- Run conditions compose: `runIf(A.and(B))`, `runIf(A.or(B))`, `runIf(A.not())` all work.
- `before` / `after` / `label` constraints produce deterministic ordering; a cycle errors at registration time.
- `Time<Fixed>` is populated; `FixedUpdate` runs deterministically at the configured rate; tests cover the accumulator under variable frame intervals.
- State-scoped resources are inserted on `OnEnter` and removed on `OnExit`; the exact ordering (before / after user `OnExit` systems) is documented.
- Tests in `packages/engine/src/index.test.ts` cover the full transition cycle, run-condition gating, ordering constraints, and fixed-step accumulation.
- Implementation, tests, and docs contain **no mention of parallel execution, parallel scheduling, threads, workers, or shared memory**.

## Links

- Roadmap: `docs/roadmap/engine-foundations.md` (M2 umbrella, phase 5)
- ADR-0001 (composition-only — states/transitions are systems + resources, not class hierarchies)
- Prereqs: `docs/backlog/system-param-protocol.md`, `docs/backlog/engine-resource-registry.md`
- Adjacent: `docs/backlog/engine-time-resource.md` (`Time<Virtual>` / `Time<Real>` ship there; `Time<Fixed>` ships here)
- Consumers: `docs/backlog/engine-commands-buffer.md`, `docs/backlog/transform-hierarchy.md`, `docs/backlog/engine-plugin-lifecycle.md`
- Future direction: `docs/roadmap/scenes-and-prefabs.md` (scenes use `States` as their scoping primitive)
- External: Bevy `States` ([bevy-cheatbook](https://bevy-cheatbook.github.io/programming/states.html)), Bevy run conditions ([bevy-cheatbook](https://bevy-cheatbook.github.io/programming/run-conditions.html)), Bevy schedule layout ([bevy-cheatbook](https://bevy-cheatbook.github.io/programming/schedules.html))
