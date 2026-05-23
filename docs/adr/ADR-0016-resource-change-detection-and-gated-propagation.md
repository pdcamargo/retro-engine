# ADR-0016: Resource Change Detection + `Changed<Transform>`-Gated Propagation

- **Status:** Accepted
- **Date:** 2026-05-23

## Context

ADR-0012 (M3 phase 1) shipped component change detection — `Changed<T>` / `Added<T>` query filters, `RemovedComponents<T>` param, per-system `lastSeenTick` plumbing — but explicitly deferred two adjacent surfaces:

- §7 punted **resource** change detection entirely. Resources continued to use `App.resourceChangeFrames` (keyed by `Time.frame`) and the existing `resourceChanged(ctor)` run-condition. In-place mutation via `ResMut(T)` was a documented v1 limitation — pinned by a test at `run-conditions.test.ts:247`. The follow-up named three candidate surfaces (writer-side `markResourceChanged`, reader-side `Res<T>.isChanged()`, reader-side `ChangedRes(T)`) and promised to promote when a real consumer pulled.
- §8 punted **gating `propagateTransforms` on `Changed<Transform>`**. The "parent-child dirtiness flow" question (a parent's `Transform` mutation does not bump children's `Transform.changedTick`, but their `GlobalTransform`s are stale) was flagged as wanting its own design slice. `propagateTransforms` kept recomputing every `GlobalTransform` from scratch in `'postUpdate'`.

This ADR closes both deferrals in one slice — they sit on the same M3 change-detection foundation, share the same end-to-end test plumbing, and the propagation gating is the first concrete consumer of the resource-frame plumbing the readers need. ADR-0012's body stays frozen per CLAUDE.md §3; this ADR invokes §7 and §8 by narrative reference, mirroring how ADR-0015 consumed ADR-0013's §11.

The new ADR also lands a small **prerequisite correctness fix**: `Commands.appendChild`'s in-place reparenting branch (mutating an existing `Parent` component's `entity` field) did not call `world.markChanged(child, Parent)`. That's an independent gap — any consumer using `Changed<Parent>` since ADR-0012 phase 1 misses reparenting via `addChild` on a child that already has a `Parent` — and it is load-bearing for the propagation gating's dirty-set source #2.

## Decision

### 1. Writer-side: `markResourceChanged(T)` on `App` and `Commands`

Two surfaces, both stamping `App.currentFrameNumber()` into the existing `resourceChangeFrames` map:

- `App.markResourceChanged<T>(ctor)` — synchronous. Used by tests, plugin lifecycle, and any caller holding an `App` reference outside a system body. `devWarn` no-op when the resource is not currently registered (mark-changed against a missing key is more often a typo than a sentinel; the warn surfaces the gap without forcing every caller to guard with `resourceExists`).
- `CommandsHandle.markResourceChanged(type)` — deferred via a new `markResourceChanged` `CommandOp` arm. Used inside system bodies that mutated a resource via `ResMut(T)` and want the mark to chain with other commands in the same flush. The arm calls `app.markResourceChanged(ctor)` at apply-time so the deferred and synchronous paths share a single code path.

Neither surface touches the new `resourceAddedFrames` map. Mark-changed is for in-place mutations, not insertions.

Symmetric writer-side counterpart to `World.markChanged(entity, type)` for components. Does not introduce auto-tracking for direct field writes — the explicit-mark discipline carries over.

### 2. Reader-side: `ChangedRes(T)` and `ResAdded(T)` as parallel params

Two new `Param<boolean>` factories declared alongside `Res(T)` / `ResMut(T)` in a system signature. Non-breaking — neither factory changes any existing param's resolved shape:

- `ChangedRes(ctor)` — resolves to `true` iff the resource's change-frame stamp is in the system's observation window.
- `ResAdded(ctor)` — resolves to `true` iff the resource's *added*-frame stamp is in the window. Mirrors the component-side `Added<T>` filter.

Wrapper-style `Res<T>.isChanged()` / `Res<T>.isAdded()` was considered and rejected: it would break every existing `Res` / `ResMut` call site (rewrite `c.value += 1` as `c.value.value += 1`) and couple change-detection metadata to the resource value's type shape. Parallel-param shape is zero-coupling, consistent with `RemovedComponents(T)`, and recoverable later as sugar if a consumer pulls.

Both factories are token-cached per constructor — `ChangedRes(Foo) === ChangedRes(Foo)` — same identity rule as `Res` / `ResMut` / `Query` so a future schedule planner can dedup intent by token identity.

### 3. `resourceAddedFrames` — separate map, distinct lifecycle

A parallel slot on `App` next to `resourceChangeFrames`, stamped only when a resource is inserted **fresh** (the constructor key was not previously registered). Re-inserts that replace an already-registered resource bump the change-frame but not the added-frame, mirroring the component-side `insertBundle` rule (newly-added types receive `addedTick = changedTick = freshTick`; types already on the entity bump only `changedTick`). `removeResource` clears the entry so a future re-insert counts as a fresh add again — useful for systems doing one-time setup whenever a resource appears.

| Operation | `resourceChangeFrames` | `resourceAddedFrames` |
|---|---|---|
| `insertResource` (key absent) | stamped with current frame | stamped with current frame |
| `insertResource` (key present — replace) | stamped with current frame | unchanged |
| `removeResource` (key present) | stamped with current frame | entry **deleted** |
| `removeResource` (key absent) | no-op | no-op |
| `markResourceChanged` (key present) | stamped with current frame | unchanged |
| `markResourceChanged` (key absent) | devWarn no-op | devWarn no-op |

### 4. Per-system `lastSeenFrame` plumbing

Both new params compare a resource stamp against the system's pre-run frame snapshot, so `runIf`-gated systems accumulate marks across the frames they skipped — same cross-frame accumulation property ADR-0012 §6 baked in for component ticks.

- New `App.lastSeenFrameMap: Map<SystemId, number>` sibling to `App.lastSeenTickMap`.
- New `ResolveCtx.lastSeenFrame: number` next to `lastSeenTick`. First-run value is `-1` so any stamp ≥ 0 fires.
- `Schedule.runStage`, `State.invokeStateSystem`, and `App.renderFrame` each capture `frameAtRunStart = app.currentFrameNumber()` pre-system, thread `lastSeenFrame` into `ResolveCtx`, and call `app.recordSystemLastSeenFrame(id, frameAtRunStart)` after the system body returns and its commands flush. Exactly mirrors the existing `lastSeenTick` plumbing.

**Comparison rule asymmetry.** `ChangedRes` and `ResAdded` use `stamp >= ctx.lastSeenFrame`, **not** `>`. The frame counter is per-frame (not per-mutation like the component tick), so a mark inside a system's body lands on the same frame the system itself snapshotted as `frameAtRunStart`. Using `>=` preserves the contract that a system observes its own prior-run writes on its next run — the same contract ADR-0012 §3 documents for components. The asymmetry is encapsulated in the param resolvers and commented in source.

### 5. Gated transform propagation

A new internal system function `propagateTransformsGated` registered by `CorePlugin` against `'postUpdate'`, replacing the previous closure that called the unconditional `propagateTransforms(world, logger)` on every frame.

The dirty set is the union of three orthogonal sources, expanded via BFS over `Children`:

1. `Query([Transform], { changed: [Transform] })` — local Transform mutations, plus freshly-spawned entities (whose `Transform.changedTick === addedTick === spawn-tick`).
2. `Query([Parent], { changed: [Parent] })` — reparenting events. Catches both initial parent assignment (archetype-transition path bumps the tick automatically) and in-place reparenting via the §6 fix below.
3. `RemovedComponents(Parent)` — entities that just lost their `Parent` and became roots. Their `GlobalTransform` shifts from `parent_global × local` to `local` and is stale even though their `Transform.changedTick` did not move.

Each entity in the union is BFS-expanded along `Children` so a parent's mutation reaches every descendant (the parent-child invariant ADR-0012 §8 flagged). Conservative dirty set — over-inclusion is acceptable, strict-minimum is a future optimisation. The compose loop iterates the expanded set in depth-ascending order so any parent is composed before its children.

On every entity whose `GlobalTransform` is recomputed, the pass calls `world.markChanged(entity, GlobalTransform)`. Downstream consumers (canonical case: a renderer uploading only dirty world matrices to the GPU) filter on `{ changed: [GlobalTransform] }`.

On a frame with no dirty roots, the pass returns immediately — no row scan, no depth sort.

The original free `propagateTransforms(world, logger)` is preserved as an unconditional full-recompute primitive for ad-hoc scene preparation, tests, and any future "force-resync" caller. Engine-driven per-frame propagation goes through the gated path.

**Direct field writes still need `markChanged`.** Mutating `transform.translation[0] = 5` does not auto-bump `Transform.changedTick` — the same ergonomics gap that exists today for every `Changed<T>` consumer per ADR-0012 §1. Systems that mutate `Transform` via direct field writes must follow up with `world.markChanged(entity, Transform)` to be picked up by the dirty-set filter. A future auto-marking surface (Proxy, `MutRef<T>`, setter-based) is its own slice.

### 6. Reparenting bump fix in `commands.ts`

The `appendChild` arm's in-place mutation branch (`existingParent.entity = op.parent`) now calls `app.world.markChanged(op.child, Parent)`. The archetype-transition branch (`applyInsertWithHooks(... [new Parent(op.parent)] ...)`) already bumps `Parent.changedTick` via `insertBundle`. With both branches consistent, `Query([Parent], { changed: [Parent] })` catches every reparenting path, which is what source #2 of the dirty set depends on.

Independently a correctness improvement for any consumer using `Changed<Parent>` from ADR-0012 phase 1 — reparenting via `addChild` on a child that already has a `Parent` is now visible to the change-detection surface.

### Rejected alternatives

- **Wrapper-style `Res<T>.isChanged()`.** Would break every existing `Res` / `ResMut` call site. Bevy-idiomatic but the breaking cost is steep relative to the parallel-param shape's drop-in ergonomics. Recoverable later as sugar.
- **`ResMut(T).markChanged()` method on the resolved value.** Couples the marker to the resource type. Same coupling reason as why no `Res<T>.isChanged()` ships — the resolved value should be the resource, not a wrapper with metadata.
- **Bump a separate "mutation counter" for resources, store the counter as the stamp.** Would let `ChangedRes` use `>` (matching the component side's comparison rule) at the cost of a second counter on `App` and conceptual divergence from "frames stamp resources, ticks stamp components" — the two-counter model ADR-0012 §7 baked in. `>=` is the cheaper fix.
- **Strict-minimum dirty subtree for propagation.** Detecting that a parent's rotation only affects descendants with non-zero local positions, etc. Real win on large hierarchies; out of scope for v1. Promote when measurement justifies.
- **`RemovedComponents<Transform>` as a dirty-set source.** A removed `Transform` drops out of the `(Transform, GlobalTransform)` query naturally; the orphaned `GlobalTransform` is the consumer's problem to clear. Including it would be over-eager — propagation has no useful work to do on entities no longer in the propagation domain.

## Consequences

**Easier:**

- Resources participate in the same writer-side / reader-side change-detection model components have used since ADR-0012, with one symmetric primitive on each side (`markResourceChanged` ↔ `world.markChanged`, `ChangedRes` ↔ `Changed<T>` filter, `ResAdded` ↔ `Added<T>` filter).
- A reactive consumer (asset hot-reload, editor live-update, GPU upload pump) can subscribe to "resource X changed since I last looked" without all-or-nothing `runIf` gating — `runIf: resourceChanged(T)` stays as the gate flavor; `ChangedRes(T)` is the inside-the-body flavor.
- Transform propagation cost on idle frames drops to zero. On non-idle frames, cost drops from O(world) to O(dirty subtree).
- A renderer-side "upload only dirty world matrices" pass becomes a one-line filter (`Query([GlobalTransform], { changed: [GlobalTransform] })`) instead of a bespoke dirty-flag scheme.
- `Changed<Parent>` now sees every reparenting path uniformly.

**Harder:**

- One new tracking map (`resourceAddedFrames`) and one new per-system map (`lastSeenFrameMap`) on `App`. Constant per-resource and per-system overhead — negligible at typical resource counts.
- `ChangedRes` / `ResAdded` comparison uses `>=` while `Changed<T>` / `Added<T>` queries use `>`. The asymmetry is invisible to consumers (the param hides it behind a boolean) but a comment in the resolver flags it for readers of engine source.
- Systems that mutated `Transform` via direct field writes without `world.markChanged` (a pre-existing footgun for any other `Changed<T>` consumer) now stop seeing their mutations propagate. Catches one class of existing bugs while introducing a discipline rule for new code. Three tests in `hierarchy.test.ts` that exercised this pattern were updated to add the explicit mark.
- The original `propagateTransforms(world, logger)` and the new `propagateTransformsGated` coexist — the unconditional and gated variants share a depth-compute helper but otherwise duplicate the row-collection / sort / compose loop. Acceptable for v1; future maintenance signal if either drifts.

**Accepted trade-offs:**

- Explicit-mark discipline carries over from components to resources. Forgetting `markResourceChanged` after an in-place mutation is the same shape of foot-gun as forgetting `world.markChanged` after mutating a component — documented in the `markResourceChanged` JSDoc and pinned by the preserved "does NOT fire on in-place mutations without an explicit `markResourceChanged`" test.
- Conservative dirty-set expansion. A parent's mutation propagates dirtiness through every descendant via the `Children` BFS, even descendants whose `GlobalTransform` would mathematically be unchanged. Strict-minimum subtree is recoverable.

## Implementation

- `packages/engine/src/index.ts` — `App.markResourceChanged`, private `resourceAddedFrames` and `lastSeenFrameMap`, `getResourceAddedFrame` accessor, `lastSeenFrameOf` / `recordSystemLastSeenFrame` helpers, `currentFrameNumber` promoted to `@internal` public, modified `insertResource` / `removeResource`, `renderFrame` snapshot/write parity, re-exports `ChangedRes` and `ResAdded`.
- `packages/engine/src/commands.ts` — `markResourceChanged` `CommandOp` variant + `applyCommandOp` arm, `CommandsHandle.markResourceChanged`, in-place reparenting `markChanged` call.
- `packages/engine/src/system-param.ts` — `ResolveCtx.lastSeenFrame`, `ChangedRes`, `ResAdded`.
- `packages/engine/src/schedule.ts` — `lastSeenFrame` snapshot/write in `runStage`.
- `packages/engine/src/state.ts` — `lastSeenFrame` snapshot/write in `invokeStateSystem`.
- `packages/engine/src/observers.ts` — `lastSeenFrame: -1` in `invokeObserver`'s synthetic `ResolveCtx`.
- `packages/engine/src/hierarchy.ts` — `propagateTransformsGated` (new), `propagateTransforms` (unchanged, preserved as ad-hoc primitive).
- `packages/engine/src/core-plugin.ts` — switches the `'postUpdate'` registration to `propagateTransformsGated` with `Changed<Transform>` / `Changed<Parent>` / `RemovedComponents(Parent)` param wiring.
- `packages/engine/src/run-conditions.test.ts` — writer-side tests (`markResourceChanged` via app + via cmd, devWarn-on-missing, added-frame invariance under mark).
- `packages/engine/src/resource-change-detection.test.ts` (new) — reader-side tests (`ChangedRes`, `ResAdded`, cross-frame accumulation under `runIf`, never-inserted, independent same-signature resolution).
- `packages/engine/src/hierarchy.test.ts` — gated-propagation tests (spawn frame, idle frame, leaf-only, parent-subtree, reparent via Commands, detach via Commands); three pre-existing tests that did direct field writes updated to call `world.markChanged(entity, Transform)`.
