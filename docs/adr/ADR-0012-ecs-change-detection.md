# ADR-0012: ECS Change Detection

- **Status:** Accepted
- **Date:** 2026-05-22

## Context

M2's archetype storage already carries side-by-side tick columns per component (ADR-0005), and `World` bumps a private mutation counter on `spawn`, `insertBundle`, and `removeComponent`. The hardware is there, but no surface reads it: queries cannot filter on "changed since I last looked," no system can ask "which entities lost this component this frame," and `propagateTransforms` (ADR-0010) explicitly defers gating itself on `Changed<Transform>` until that surface exists. Scenes/prefabs, reactive UI, and editor live-update all sit downstream of the same primitive.

Bevy is the prior art ([`bevy_ecs::change_detection`](https://docs.rs/bevy_ecs/latest/bevy_ecs/change_detection/index.html)). We align where the alignment is mechanical (`Added<T>` implies `Changed<T>`, cross-frame accumulation for `runIf`-gated systems, pre-run snapshot of the system's observation window) and diverge where the divergence is deliberate (single-threaded execution, explicit mark-dirty for in-place mutation, scope deferral of resource-level finer-grained surface). Single-threaded throughout, matching every other M2/M3 decision.

## Decision

### 1. Mutation-detection mechanism — explicit mark-dirty

Structural operations bump the mutation tick automatically: `World.spawn` and `World.spawnReserved`, `World.insertBundle` (both the in-place and archetype-transition paths), `World.removeComponent`, and `World.despawn`. For in-place mutation of reference-typed component data, callers explicitly invoke `world.markChanged(entity, ComponentType)`, which bumps the tick and writes the new value into the component's `changedTick` column. Calling `markChanged` for an `(entity, type)` pair where the entity does not carry `type` is a silent no-op — mutation hints are too fragile to throw on, and the alternative (insisting on a precondition check) is friction without benefit. Mutate-through-API and Proxy-wrapped components from the roadmap's option list are not adopted; they are sugar layers that can land on top of mark-dirty later if a real consumer pulls.

### 2. Filter syntax — gate-only, no row-shape change

`QueryFilters` (in `packages/ecs/src/query.ts`) gains two optional fields, `changed?: readonly ComponentType[]` and `added?: readonly ComponentType[]`. Both gate row inclusion: a row matches iff every listed type passes its tick test. Neither appends to the yielded row tuple. The existing `has` filter, which does append a boolean per type, is the package's lone oddball and stays alone — `changed`/`added` follow the cleaner `with`/`without` convention. `changed` and `added` reference component types that must also be present on the entity (verified at filter time via the archetype's type set, equivalent to a `with` clause for the same type).

### 3. Per-system tick + tick ownership — pre-run snapshot

The world owns the mutation tick. The existing private `World.tickCounter` is promoted to a public read-only getter `World.changeTick: number`; `bumpTick()` remains private (only the world mutates the tick — `markChanged` is the public mutation-hint API, not a write to the tick). A sidecar `Map<SystemId, number>` lives on `App` (alongside `resourceChangeFrames`) so the schedule can record each system's last-observed tick without touching `RegisteredSystem`'s `readonly` shape.

**Snapshot is pre-run (Bevy-aligned).** When the schedule is about to invoke system S, it reads `lastSeen = lastSeenTickMap.get(systemId) ?? 0`, captures `tickAtRunStart = world.changeTick`, threads `lastSeen` into `ResolveCtx`, runs S (params resolve using `lastSeen`), then writes `lastSeenTickMap.set(systemId, tickAtRunStart)`. The post-run write deliberately stores the *pre-run* tick — so on its next invocation, S re-observes its own prior-frame mutations (mutations with `tick > tickAtRunStart` from the prior frame are still in the new run's observation window). This matches Bevy's contract: a system that spawns an entity can also process it via its own `Added<T>` filter on the next run.

`Time.frame` (the per-frame counter on the `Time` resource) is untouched. The two counters coexist: `World.changeTick` is per-mutation and drives component change detection; `Time.frame` is per-frame and drives `resourceChanged` and other frame-keyed gates.

### 4. `RemovedComponents<T>` — param-style, frame-boundary drain

Removal observation is a system param, not a query filter: `RemovedComponents(ctor)` resolves to `Iterable<Entity>`. Bevy returns entities (not removed values — the component data is gone by the time observers see it); we follow.

Per-component-type buffer on the world: `Map<ComponentType, Array<{ entity: Entity, tick: number }>>`. Populated by:

- `World.removeComponent` — one entry for the type being removed.
- `World.despawn` — one entry per component the despawned entity carried, before the row is swap-removed (so the despawned components are enumerable at the moment of the event).

Param resolution filters entries by `entry.tick > ctx.lastSeenTick`. Drain semantics: **frame-boundary**. At the end of `App.advanceFrame`, after all stages (Main, FixedMain, render) run, the world's `drainRemovedBuffer` clears every entry. v1 limitation: a `runIf`-gated system that does not run during frame F loses frame F's removals. Documented; not blocking for the immediate consumers (propagation, scenes, reactive UI).

### 5. `Added<T>` implies `Changed<T>` — two tick columns per component

Storage carries two parallel tick maps per archetype: `changedTickColumns` (rename of the existing `tickColumns`) and `addedTickColumns` (new). Write rules:

- **`spawn` / `spawnReserved`**: for every component on the new row, `addedTick = changedTick = freshTick`.
- **`insertBundle` in-place** (no archetype transition; every component in the bundle is already on the entity): for each replaced component, `changedTick = freshTick`. `addedTick` unchanged. Replace semantics.
- **`insertBundle` archetype-transition**: for retained components (in the old archetype, not in the bundle), both ticks preserved across the move. For components new to the entity, `addedTick = changedTick = freshTick`. For components already on the entity but also present in the bundle (user explicitly re-inserted), `changedTick = freshTick`, `addedTick` preserved.
- **`markChanged`**: `changedTick = freshTick`. `addedTick` untouched.
- **`removeComponent`**: writes neither tick column for the removed type (it leaves the archetype). Retained components preserve both ticks across the move. Pushes an entry into `removedBuffer`.
- **`despawn`**: writes neither tick column (the row is destroyed). Pushes one `removedBuffer` entry per component the entity carried. Bumps the tick so the buffer entries get a fresh stamp.

By construction, every operation that bumps `addedTick` also bumps `changedTick` to the same value — so `Added` implies `Changed`.

### 6. Cross-frame accumulation — automatic

A `runIf`-gated system that does not run in frame F leaves its `lastSeenTick` untouched (the schedule's post-run write is gated on the system actually running). On its next actual run, its observation window covers every mutation since its last actual run, not just this frame's. The model is the same for `Changed` and `Added` filters — the data lives on the row, so cross-frame accumulation falls out for free. For `RemovedComponents`, the frame-boundary drain bounds accumulation (see decision 4).

### 7. Resource change-detection — deferred entirely

Resources continue to use `App.resourceChangeFrames` and the existing `resourceChanged` run-condition unchanged. No `Res<T>.isChanged()`, no `ChangedRes(T)` param in this slice. The two counters (frame for resources, mutation-tick for components) live side-by-side. A finer-grained mid-system resource-change surface, bridging resources to `World.changeTick` or introducing a `markResourceChanged`, promotes from backlog when a real consumer pulls (reactive UI, asset hot-reload, editor tooling) — at that point this ADR is superseded for the resource half.

### 8. `propagateTransforms` — surface only, not the optimization

`propagateTransforms` keeps recomputing every `GlobalTransform` from scratch in `'postUpdate'`. ADR-0010 stays unchanged. Gating propagation on `Changed<Transform>` is a separate behavioral change (parent-child dirtiness flow has its own design questions — how does a parent's mutation flow to children's `GlobalTransform`?) and gets its own slice.

### Rejected alternatives

- **Mutate-through-API only / Proxy-wrapped components for mutation detection.** Wrapped-accessor verbose at every mutation site; Proxy adds measurable per-access cost and obscures the mental model ("why does my `get` return something that isn't my component?"). Explicit mark-dirty is the cheapest correct primitive; the others are sugar layers that can land later.
- **`Changed`/`Added` as row-tuple appenders (Bevy-style `Has` analog).** Would let systems destructure `[T, isChanged, isAdded]` per row. Rejected: `has` already does this for component presence and is the package oddball; doubling down on the pattern for ticks bloats every yielded row. Gate-only semantics keep the common case (filter on changed, iterate component data) flat.
- **Post-run snapshot for `lastSeenTick` (advance past own mutations).** Cleaner self-loop semantics ("I never re-observe my own changes") but breaks the Bevy contract that systems can process their own spawns/inserts via `Added<T>` on their next run. The Bevy contract is the more useful default; the post-run model is recoverable as a per-system opt-out if a consumer needs it.
- **Frame counter (`Time.frame`) as the change tick.** Multiple mutations in a single frame would share a tick — destroys per-row "was this row changed since lastSeen" precision. The mutation counter is the only correct primitive.
- **Tick-based retention for `RemovedComponents` (drain only entries older than the minimum lastSeenTick across all systems).** Correct for cross-frame accumulation but adds a tracking structure for a v1 limitation no current consumer hits. Frame-boundary drain is the simplest correct behavior; promote to tick-based retention when a consumer pulls.
- **Ship `Res<T>.isChanged()` or `ChangedRes(T)` alongside the component primitive.** Requires deciding how a resource counts as "mutated" (insert/replace/remove already counted; in-place needs a `markResourceChanged`), what counter the surface aligns with (`Time.frame` vs `World.changeTick`), and whether `Res(T)` resolves to a value or a wrapper. Each decision is independent of the component primitive and has its own ADR's worth of design. Deferring keeps this slice tight.
- **Gate `propagateTransforms` on `Changed<Transform>` in this slice.** Behavioral change with parent-child invariants worth their own scrutiny — what if a parent's `Transform` changed but the child's didn't? The naive `Changed<Transform>` filter misses the propagation case. Out of scope.

## Consequences

**Easier:**

- Systems can express "process only entities whose `T` changed/added since I last ran" via a one-line filter clause. No bespoke dirty flags per consumer.
- `propagateTransforms` has the primitive it needs to be gated on `Changed<Transform>` when that optimization is taken (separate slice).
- Scenes/prefabs, reactive UI, asset hot-reload, and editor live-update all build on top of one primitive rather than re-inventing change tracking each time.
- Cross-frame accumulation works automatically for `runIf`-gated systems — no special-case wiring needed at the consumer level.
- The schedule's per-system tick state is uniform across stages (Main, FixedMain, state transitions, render), so a system's observation window is consistent regardless of when it runs.

**Harder:**

- Two tick columns per component (`addedTickColumns` + `changedTickColumns`) doubles the per-archetype tick metadata. Each is a plain JS `number` array; at 10k entities × 5 components × 2 tick arrays = 100k numbers ≈ 800 KB worst-case. Acceptable for v1; aligns with the storage-perf roadmap's "promote when measurement justifies" stance.
- Explicit `markChanged` is a discipline: forgetting it means a `Changed<T>` query silently misses your mutation. Documented in the `markChanged` JSDoc; surfaces via the same pattern as Commands ("if you forget to flush, your op doesn't apply").
- `RemovedComponents` cross-frame for `runIf`-gated systems is a known v1 limitation (decision 4). Not blocking, but documented.
- Two counters coexist (`World.changeTick` per-mutation, `Time.frame` per-frame). When the resource finer-grained surface lands, this ADR is superseded for the resource half.

**Accepted trade-offs:**

- Component data mutations are detected through explicit hints, not automatic tracking. Mirrors Bevy's `Mut<T>` deref-write idiom (where Bevy's `Mut` proxy bumps the tick on `deref_mut`), translated to a TypeScript world without first-class deref-overload.
- Pre-run snapshot means a system re-observes its own prior-frame mutations on its next run. Surprising the first time you hit it (a system that mutates `Foo` will see its own entity via `Changed<Foo>` on the next frame), but it's the documented Bevy contract and avoids the "I changed it, why doesn't `Added` fire for me?" foot-gun.
- Frame-boundary drain for `RemovedComponents` is the simplest correct behavior with one documented limitation. Tick-based retention is recoverable.

## Implementation

- `packages/ecs/src/archetype.ts` — `Archetype` carries `changedTickColumns` (rename of prior `tickColumns`) and a new `addedTickColumns`. `push(entity, entries)` takes a per-component map of `{ value, addedTick, changedTick }`. `swapRemove(row)` maintains both tick columns in parallel.
- `packages/ecs/src/change-detection.ts` — `RemovedEntry` type; predicate helpers `isChangedSince`, `isAddedSince`; tick-write helpers `writeChangedTick`. Internal-only.
- `packages/ecs/src/world.ts` — `World.changeTick` public getter; `World.markChanged(entity, type)` public method; internal `removedBuffer: Map<ComponentType, RemovedEntry[]>`; public `drainRemovedBuffer()` called by the schedule at frame boundary. `spawn` / `spawnReserved` / `insertBundle` (both paths) / `removeComponent` / `despawn` write the tick columns and removed buffer per the rules in decision 5. `iterateQuery` and `iterateQueryEntries` accept an optional `sinceTick` arg and consult `changed`/`added` filters to gate rows.
- `packages/ecs/src/query.ts` — `QueryFilters` gains `changed?: readonly ComponentType[]` and `added?: readonly ComponentType[]`. `Query` stores an optional `sinceTick` and threads it to the iterator helpers.
- `packages/ecs/src/index.ts` — re-exports `RemovedEntry`.
- `packages/engine/src/system-param.ts` — `ResolveCtx` carries `lastSeenTick: number`. `Query(types, filters)` param's `resolve` passes `ctx.lastSeenTick` as the third arg to `world.query`. Query cache key includes `changed`/`added` filter content.
- `packages/engine/src/change-detection.ts` — `RemovedComponents(ctor)` factory returning `Param<Iterable<Entity>>`.
- `packages/engine/src/schedule.ts` — `runStage` captures `tickAtRunStart` pre-system, threads `lastSeen` into `ResolveCtx`, writes `App.lastSeenTickMap.set(sys.id, tickAtRunStart)` after the system function returns.
- `packages/engine/src/state.ts` — `invokeStateSystem` matches `runStage`'s pre-run snapshot + post-run write pattern so state-transition systems participate in change detection.
- `packages/engine/src/index.ts` — `App` gains private `lastSeenTickMap`, public `getSystemLastSeenTick(id)` (internal accessor used by system param resolvers if needed). `App.advanceFrame` calls `world.drainRemovedBuffer()` at frame end. `App.renderFrame` matches the `runStage` snapshot pattern for render-stage systems. Re-exports `RemovedComponents`.
- `packages/ecs/src/change-detection.test.ts` — tick-column semantics, `markChanged`, `removedBuffer`, query filter behavior (`changed`, `added`, composition), default-`sinceTick` regression.
- `packages/engine/src/change-detection.test.ts` — end-to-end through `App.addSystem`: `Changed<T>` / `Added<T>` filters via `Query`, `RemovedComponents` param, pre-run snapshot, cross-frame accumulation under `runIf`, frame-boundary drain.
