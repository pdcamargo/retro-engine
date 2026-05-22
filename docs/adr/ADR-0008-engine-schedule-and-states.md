# ADR-0008: Engine Schedule, States, and Run Conditions

- **Status:** Accepted
- **Date:** 2026-05-22

## Context

After phases 1-4 the engine has a `Param` protocol, a resource registry, a `Time` resource, and an archetype world with multi-component queries. The `App` frame loop still drives only five stages — `'first' → 'preUpdate' → 'update' → 'postUpdate' → 'render'` — with `'startup'` once before the first frame, registration-order execution within each stage, no run conditions, no state machinery, no fixed timestep. Six interlocking surfaces are needed before phases 6-8 (`Commands`, transform hierarchy, plugin lifecycle) can land cleanly:

1. **A richer schedule** — Bevy-shaped Main + FixedMain layout, including a `Last` cleanup stage and a `StateTransition` phase the engine drives.
2. **States** — typed state machines with `OnExit / OnTransition / OnEnter` schedules and an `inState` run condition.
3. **Run-condition helpers** — `inState`, `resourceExists`, `resourceChanged`, `anyWithComponent`, composable through the existing `RunCondition` class.
4. **Ordering within a stage** — labels plus `before` / `after`, with cycle detection. Single-threaded; ordering is the win, not parallel safety.
5. **Fixed timestep** — accumulator-driven `FixedMain` loop, `Time.fixed` sub-clock, spiral-of-death cap.
6. **State-scoped resources** — first-class, with sealed cleanup ordering relative to user `OnExit` systems.

These six interlock — splitting them produces a half-built scheduler with no test coverage. They land together, gated by this ADR which seals every execution-time decision the work forces.

Single-threaded throughout. No parallel-scheduling, threads, workers, or shared-memory anywhere in the design.

## Decision

### 1. Main schedule order

Each frame runs:

```
First → Startup (first frame only) → PreUpdate → StateTransition →
RunFixedMainLoop → Update → PostUpdate → Last → Render
```

`Startup` runs once on the first frame, between `First` and `PreUpdate`. The initial state transition fires during the **first frame's** `StateTransition` — after `Startup`, not before it. This is a deliberate deviation from Bevy 0.14+ (which moved initial `OnEnter` to before `PreStartup`, see [bevyengine/bevy#14208](https://github.com/bevyengine/bevy/pull/14208)). The rationale is local: our `Startup` stage is for engine-boot wiring (pipeline construction, resource allocation) that does not need to know which state is initial; user code that depends on `OnEnter(initial)` having run lives in `Update` or later, where the initial transition is already complete.

### 2. FixedMain schedule order

Inside `RunFixedMainLoop`, the fixed sub-schedule runs zero or more times per frame:

```
FixedFirst → FixedPreUpdate → FixedUpdate → FixedPostUpdate → FixedLast
```

### 3. State schedules

A state transition `S_old → S_new` executes the following per-pair sequence inside `StateTransition`:

```
a. Run user OnExit(S_old) systems
b. Remove state-scoped resources registered for S_old
c. State<S>.current = S_new
d. Run user OnTransition(S_old, S_new) systems
e. Insert state-scoped resources registered for S_new
f. Run user OnEnter(S_new) systems
```

`inState(S_old)` is `true` during step (a). `inState(S_new)` is `true` from step (d) onward. `Res(State(S))` resolves to the live value at the moment the system reads it — no snapshotting.

### 4. State-scoped resource cleanup ordering

State-scoped resources are removed **after** user `OnExit(S_old)` systems run (step b), so user `OnExit` code can read the resource one last time. They are inserted before user `OnEnter(S_new)` systems run (step e), so `OnEnter` code can read the freshly inserted resource. This locks the recommended default from `docs/roadmap/engine-foundations.md`.

### 5. Initial transition

The first transition has no `S_old`. Only steps (c), (e), (f) run — `State<S>.current = S_initial`, insert state-scoped resources for `S_initial`, run user `OnEnter(S_initial)` systems. No `OnExit`, no `OnTransition`. Detected at runtime by `State<S>.current === undefined` prior to step (c).

### 6. NextState semantics

`NextState<S>` is a per-state-type resource with a single `value: S | undefined` slot and a `set(s: S)` method. Multiple calls to `.set()` within one frame coalesce: only the final value is read at the next `StateTransition`. After applying a transition the slot is cleared back to `undefined`. Setting `.value` to the current state still fires a full `OnExit → OnTransition → OnEnter` cycle (identity transitions are supported by design).

### 7. OnTransition is per-pair only

Users register `app.onTransition(from, to, params, fn)` against a specific ordered pair. There is no any-to-any helper in v1. Composing "react to any change to state type T" is straightforward today (`addSystem` against a `last` stage with a `Res(State(T))` and a closed-over previous value) and trivial later if change detection lands.

### 8. State type identity

A state type is the user's class constructor; state values are instances of that class. Factories take the type token explicitly:

```ts
class GameState {
  static readonly Boot    = new GameState('Boot');
  static readonly Playing = new GameState('Playing');
  constructor(public readonly name: string) {}
}

app.initState(GameState, GameState.Boot);
app.addSystem('update', [ResMut(NextState(GameState))], (next) => next.set(GameState.Playing));
app.addSystem('update', [Res(State(GameState))], (s) => { /* s.current */ });
app.addSystem('update', [/*...*/], movePlayer, { runIf: inState(GameState.Playing) });
```

`State(ctor)` and `NextState(ctor)` are factories cached in a `WeakMap<ctor, MintedClass>`. Each mints a unique class on first call; that minted class is the registry key for `App.insertResource`. `Res(State(GameStateA))` and `Res(State(GameStateB))` resolve to distinct resources because the minted classes differ.

`inState(value)` reads `value.constructor` once at construction and looks up `app.getResource(State(value.constructor))` at evaluation. Identity comparison is used (`current === value`); the recommended pattern of `static readonly Foo = new C('Foo')` makes this safe.

No `States` base class. No `__stateType` static marker. No subclassing required. This honours ADR-0001 / CLAUDE.md §5.1-§5.2 composition-default.

`initState` is two-argument (`initState(ctor, initial)`) so the runtime never has to infer the type key from `initial.constructor`. Runtime asserts `initial.constructor === ctor` and throws if they disagree (catches subclass-of-state-class mistakes early).

### 9. `resourceChanged` v1 semantics

`resourceChanged(ctor)` returns `true` when the resource was **inserted or removed** during the current frame, judged by frame counter equality against `Time.frame`. In-place mutations (e.g. `ResMut(Score).value = 5`) are **not** detected in v1; the resource is the same instance and no frame stamp is bumped. Documented sharp edge.

Implementation: `App` keeps `private readonly resourceChangeFrames = new Map<ctor, number>()`, written by `insertResource` and `removeResource` to the current `Time.frame`. `resourceChanged(ctor).test(app)` returns `frames.get(ctor) === app.getResource(Time)?.frame`. Same condition produces the same answer for every system in the frame — there is no per-system memory.

Rationale: a Bevy-faithful per-system change-tick model widens `RunCondition.test(app)` for a single helper and locks the engine into a versioning scheme that M3's planned generation-counter change detection might not want. M3 ships `Changed<T>` (`docs/roadmap/change-detection.md`); it supersedes this helper.

### 10. Cycle detection

Systems in any stage may carry `label?: string`, `before?: readonly string[]`, `after?: readonly string[]`. Ordering is per-stage; a label in stage A is not visible to constraints in stage B.

The runner maintains, per stage, a `topoCache: SystemId[] | null`. `addSystem` appends the new system and runs Kahn's topo sort eagerly; if a cycle is found, the registration is rolled back and `addSystem` throws an `Error` naming the cycle. Forward-referenced labels are allowed — an `after: ['foo']` constraint against a label not yet registered is skipped during the eager check and picked up the moment the labelled system registers (which re-runs the topo sort). `runStage` consumes the cache and invalidates it on each `addSystem`.

### 11. Fixed-timestep spiral-of-death cap

`RunFixedMainLoop` reads `Time.virtual.delta` each frame (zero when virtual is paused), adds it to an internal accumulator, and runs `FixedFirst → FixedPreUpdate → FixedUpdate → FixedPostUpdate → FixedLast` while `accumulator >= timestep` **and** `substepsThisFrame < 8`. Default `timestep = 1/60` seconds; configurable on `Time.fixed.timestep`. If the cap is reached and the accumulator is still ≥ `timestep`, the residual is dropped and a single `app.logger.warn(...)` fires for that frame. `Time.fixed.overstep = accumulator / timestep` after the loop, useful for future render-side interpolation.

`Time.fixed.delta` equals `timestep` while a substep is running; `0` outside the loop.

### 12. Internal phases vs user-registerable stages

`'stateTransition'` and `'runFixedMainLoop'` are **internal** driver phases. They execute schedules synthesized from `onExit` / `onEnter` / `onTransition` registrations and from `fixed*`-stage systems respectively. They are not in the public `Stage` union; users register through the dedicated APIs (`app.onEnter(...)`, `app.addSystem('fixedUpdate', ...)`).

The user-facing `Stage` union is:

```
'startup' | 'first' | 'preUpdate' | 'update' | 'postUpdate' | 'last' | 'render' |
'fixedFirst' | 'fixedPreUpdate' | 'fixedUpdate' | 'fixedPostUpdate' | 'fixedLast'
```

## Consequences

**Easier:**
- Gameplay code can carve work across `Last` (cleanup after `PostUpdate`) and `fixedUpdate` (deterministic physics-shaped logic) without ad-hoc workarounds.
- States + run conditions let plugins scope systems and resources to game phases without resorting to closure-side flags.
- Ordering with explicit labels makes "input runs before motion runs before collision" a one-line constraint, not a documented convention.
- The schedule layout matches Bevy closely, so prior art (cheatbook, docs.rs) maps to our surface with minor renames.
- New diagnostic surfaces (cycle errors, spiral-of-death warnings) flow through the `app.logger` capture from ADR-0007 — no `console.*` calls.

**Harder:**
- The user-facing `Stage` union is wider; an exhaustive `switch` over stages now lists twelve cases.
- `resourceChanged` v1 is coarse. Until M3 lands `Changed<T>`, in-place mutations require user-side state to detect. We document this prominently in the helper's TSDoc.
- The phase deviates from Bevy's initial-transition-before-`PreStartup` decision. Plugin authors familiar with Bevy must be reminded that `Startup` runs **before** `OnEnter(initial)` here.
- The minted-class identity model for `State(ctor)` / `NextState(ctor)` is unfamiliar at first read. We rely on the same WeakMap-cached factory pattern already used by `Res` / `ResMut` / `Query`, so the cost is one paragraph in the TSDoc.

**Accepted trade-offs:**
- One PR that bundles six concerns. Splitting yields a non-testable scheduler. We mitigate with a documented mid-implementation split point (`5a` schedule rewrite + ordering + fixed timestep; `5b` States + run conditions + state-scoped resources) if size exceeds plan.
- `resourceChanged` is intentionally coarse. M3 supersedes.

## Implementation

- `packages/engine/src/index.ts` — `App`, `Stage`, `AddSystemOptions` (now with `label`/`before`/`after`), `initState`, `onEnter`/`onExit`/`onTransition`, `insertStateScopedResource`, public re-exports of `State`, `NextState`, `inState`, `resourceExists`, `resourceChanged`, `anyWithComponent`.
- `packages/engine/src/schedule.ts` — `runStage`, `runMain`, `runFixedMainLoop`, topo-sort + cycle detection.
- `packages/engine/src/state.ts` — `State(ctor)`, `NextState(ctor)`, state-type registry, `runStateTransition`, state-scoped resource registry.
- `packages/engine/src/run-conditions.ts` — `inState`, `resourceExists`, `resourceChanged`, `anyWithComponent`.
- `packages/engine/src/fixed-time.ts` — `FixedClock` interface, accumulator state, fixed-step driver.
- `packages/engine/src/time.ts` — extended with `fixed: FixedClock` sub-clock.
- `packages/engine/src/schedule.test.ts`, `state.test.ts`, `fixed-time.test.ts`, `run-conditions.test.ts` — concern-scoped test coverage.
- `packages/engine/src/index.test.ts` — end-to-end integration test exercising states + ordering + fixed step + render.
