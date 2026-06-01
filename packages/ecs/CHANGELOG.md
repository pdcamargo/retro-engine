# @retro-engine/ecs

## 0.1.0

### Minor Changes

- 5ea3e80: Replace the day-1 stub `World` with archetype-graph storage: each unique component set is an archetype with parallel columns of component data plus a side-by-side last-mutation tick column. Adds:

  - Multi-component `world.query([A, B])` returning an iterable `Query` handle with `.single()`, `.first()`, `.count()`.
  - Filter shapes: `with`, `without`, `has`. `has` appends one boolean per entry to each yielded row in declaration order.
  - Required Components — a component class declares `static requires: ComponentType[]`, and spawning resolves the dependency graph transitively (with cycle detection and a default-constructibility check).
  - `Disabled` marker — entities carrying `Disabled` are excluded from queries by default; pass `{ with: [Disabled] }` to opt back in.
  - `world.entity(e)` builder returning a chainable `EntityRef` with `.insert(...)`, `.remove(...)`, `.get(...)`, `.has(...)`, `.despawn()`.
  - Variadic `world.spawn(...)` accepting individual components or a single array bundle.
  - Per-column tick storage so the future change-detection filters (`Changed<T>` / `Added<T>`) can land without re-storaging.

  Breaking: `ComponentType<T>` no longer accepts `symbol` — components are identified by their class constructor exclusively. Migrate symbol-based markers to empty classes (`class Disabled {}`).

- 2f22822: feat(ecs,engine): ECS change detection — Changed<T> / Added<T> / RemovedComponents<T>

  Surface the per-component mutation ticks already wired into archetype storage so systems can observe what changed since they last ran. First slice of M3 ECS reactivity; sealed in ADR-0012.

  **ECS (`@retro-engine/ecs`):**

  - `World.changeTick` — public read-only getter exposing the monotonic mutation counter. Advances on every `spawn`, `insertBundle`, `removeComponent`, `despawn`, and `markChanged`.
  - `World.markChanged(entity, type)` — explicit mark-dirty for in-place mutation of reference-typed component data. Bumps the tick and writes the new value into the component's `changedTick` column. Silent no-op on unknown entity or absent component.
  - `QueryFilters` gains `changed?: ComponentType[]` and `added?: ComponentType[]`. Both gate row inclusion against a per-system `sinceTick` threshold; neither alters row shape (unlike `has`).
  - `World.query(types, filters, sinceTick?)` — new optional third arg threads through to the filter check. Defaults to `0` ("observe everything") so existing callers behave identically.
  - Storage carries two parallel tick columns per component — `changedTickColumns` (mutation) and `addedTickColumns` (attach). `Added<T>` implies `Changed<T>` by construction.
  - Per-component removal buffer on `World` populated by `removeComponent` and `despawn`. Read via internal `getRemovedComponents(type)`; drained at frame boundary by `drainRemovedBuffer()`.
  - `RemovedEntry` type re-exported from the package root.

  **Engine (`@retro-engine/engine`):**

  - `RemovedComponents(ctor)` — new system param yielding `Iterable<Entity>` over entities whose component was removed since the calling system's last run. Frame-boundary drain (v1 limitation: `runIf`-gated systems lose removals from frames they did not run in).
  - `ResolveCtx` gains a required `lastSeenTick: number`. The scheduler captures `World.changeTick` pre-system (Bevy-aligned pre-run snapshot) and writes it to a per-system `lastSeenTickMap` on `App` after the system runs. Consequence: a system re-observes its own prior-frame mutations on its next invocation.
  - `Query(types, filters)` param threads `ctx.lastSeenTick` through to `World.query` automatically. Filter cache key extended to include `changed` / `added` content.
  - All system-running paths (`runStage` for Main/FixedMain, `invokeStateSystem` for state transitions, `App.renderFrame` for render) participate in the same snapshot model.
  - `App.advanceFrame` drains the removed-components buffer at end of frame, after every stage.

  **Out of scope (deferred):**

  - Finer-grained resource change detection. `App.resourceChangeFrames` and the `resourceChanged` run-condition are unchanged; no `Res<T>.isChanged()` / `ChangedRes(T)`. Promotes from backlog when a real consumer pulls.
  - Gating `propagateTransforms` on `Changed<Transform>`. The surface is shipped here; the optimization gets its own slice.

- 62e382e: feat(ecs,engine): observers + Message<T> + component lifecycle hooks (M3 phase 2)

  Push-based half of the ECS reactivity layer, on top of the change-detection primitive shipped in ADR-0012. Sealed in ADR-0013. Adopts Bevy 0.17 vocabulary (`Message` / `Event` split, `.write` writer name) on day 1 so consumers do not face a later rename.

  **ECS (`@retro-engine/ecs`):**

  - `World.advanceTick(): number` — public additive method bumping the mutation counter without touching any tick column or removed buffer. Used by `MessageWriter.write` to stamp messages with a strictly-increasing tick, eliminating the missed-message edge case when a system writes messages but does no structural mutations.
  - `World.componentTypesOf(entity)` (`@internal`) — enumerate the component classes currently attached to an entity. Used by the engine commands flush for the per-component `onRemove` fan-out at despawn.

  **Engine (`@retro-engine/engine`):**

  - **Message channels.** `MessageWriter(ctor)` / `MessageReader(ctor)` system params. `app.addMessage(ctor)` registers a type. Writers stamp each `.write(msg)` with a fresh world tick; readers filter by `lastSeenTick`, mirroring `RemovedComponents`. Per-type buffers drain at end of `advanceFrame`, after `world.drainRemovedBuffer()`.
  - **Observers + triggers.** `commands.trigger(event)` enqueues a global trigger; `commands.entity(e).trigger(event)` enqueues an entity-targeted one. `app.addObserver(eventCtor, params, fn)` registers a global observer; `commands.entity(e).observe(eventCtor, params, fn)` registers an entity-targeted one (deterministically at flush). `Trigger(eventCtor)` param exposes `trigger.event()` and `trigger.entity()`. Targeted observers fire before globals; observers run in registration order. Triggers fire at the commands flush, not at the call site.
  - **Re-entrant triggers.** An observer body that calls `commands.trigger(...)` chains into the same flush. Depth limit 8; the 9th nested trigger emits a `devWarn` and is dropped.
  - **Component lifecycle hooks.** `onAdd` / `onInsert` / `onReplace` / `onRemove`, declared as static methods on the component class (`class Sprite { static onAdd(ctx) {…} }`) or registered via `app.registerComponentHook(ctor, kind, fn)`. Hooks fire during the commands flush — pre-mutation for `onReplace` / `onRemove`, post-mutation for `onAdd` / `onInsert`. Static methods fire before registry entries; registry entries fire in registration order. Hook ctx exposes `world`, `commands` (bound to the triggering system's buffer), `entity`, and `value`.
  - **Despawn cleans up entity-targeted observers.** No leak across entity reuse.
  - **`flushSystemCommands` reworked** to process the buffer with a while-loop pattern so ops enqueued by hooks / observers during dispatch fire in the same flush. Try-finally cleanup ensures throw-safety: the buffer entry is removed even when an applyCommandOp arm throws mid-flush.

  **Out of scope (deferred):**

  - Lifecycle-as-trigger sugar (Bevy's `Event<OnAdd<T>>` / `Event<OnRemove<T>>`). The ordering rule "observers before hooks" is locked in ADR-0013 so a follow-up slice can land the sugar without re-opening this ADR.
  - Migrating recursive despawn (`commands.entity(e).despawnRecursive`) from its manual `Children` walk to an `onRemove(Parent)` hook. Surface shipped here; migration is the natural first consumer in the follow-up slice.
  - A constrained `DeferredWorld` wrapper class. v1 hooks receive the full `World` reference + a `CommandsHandle`; recoverable when a footgun manifests in practice.
  - Direct `world.spawn` / `world.insertBundle` / `world.removeComponent` / `world.despawn` calls (outside a commands flush) do NOT fire hooks or observers in v1. Test code that needs hook coverage routes through `Commands`.

- 1280e03: feat(engine): add `Commands` system param with per-system flush

  `Commands` is a system param that records structural mutations
  (`spawn` / `despawn` / `entity().insert` / `entity().remove` /
  `insertResource` / `removeResource`) into a per-system buffer and applies
  them at deterministic boundaries — immediately after each system's
  function returns. `cmd.spawn` returns an `Entity` synchronously so
  sibling commands in the same buffer can target it. `App.flushCommands()`
  is the orchestration-side escape hatch.

  Adds `World.reserveEntity()`, `World.spawnReserved()`, and
  `World.hasEntity()` as low-level building blocks. Sealed in ADR-0009.

- ac35dac: perf(ecs): non-allocating Query.forEach for hot-path iteration

  `Query.entries()` / the row iterator allocate a fresh `[entity, ...components]`
  tuple per row and run through a generator — and a profile of the stress preset
  showed that per-frame query iteration, not the render prepare, had become the
  dominant cost once retained prep (ADR-0039) landed (systems that touch every
  entity each frame allocate ~one tuple per entity per query).

  Adds `Query.forEach(cb)` (backed by `World.forEachEntry`) that reuses a single
  row buffer across all rows and invokes the callback directly — no per-row array,
  no generator. Bench: **~4–6× faster** than `.entries()` iterating 100k entities
  (entity + 3 components). The row passed to the callback is transient — read it
  in the callback, don't retain it; `.entries()` stays for the retain-safe /
  collect case and is unchanged.

  The engine's per-frame O(n) loops migrate to it (no behavior change, parity
  tests green): the visibility cull, the retained sprite + 3D/2D mesh prepare base
  walks, and the atlas animation ticker. Also factors the shared archetype-match
  test out of the two existing query iterators.

  **New public surface:** `Query.forEach`.

- 5c33631: feat(engine): render world + render schedule sets (ADR-0019)

  Closes Phase 1.4 + 1.5 of the renderer roadmap. The engine now hosts a second
  `World` for render-only data, plus a six-set sub-ordering inside the
  `'render'` stage. Backwards-compatible — existing render-stage systems
  default to the `Render` set and keep working unchanged.

  ### App.renderWorld

  A literal second `World` instance, peer to `app.world`. Render-stage system
  params resolve against it by default. Cleared at the start of every
  `renderFrame()` — entities do not persist across frames, but resources do.

  ```ts
  app.addSystem("render", [Query([ExtractedSprite])], (q) => {
    for (const [s] of q) record(s);
  });
  ```

  Read main-world data via the new `Extract<P>` wrapper:

  ```ts
  app.addSystem(
    "render",
    [Extract(Query([Sprite, GlobalTransform]))],
    (q) => {
      for (const [sprite, transform] of q) {
        app.renderWorld.spawn(new ExtractedSprite(sprite, transform.matrix));
      }
    },
    { set: RenderSet.Extract }
  );
  ```

  ### RenderSet

  `AddSystemOptions.set?: RenderSetName` slots a render-stage system into one
  of six sub-sets, run in fixed order each frame:

  ```
  Extract → Prepare → Queue → PhaseSort → Render → Cleanup
         (no encoder)        ↑ pass open ↑    (encoder finished)
  ```

  Systems with no explicit set default to `RenderSet.Render` — the existing
  single-pass behaviour. The `set` option is rejected at registration for any
  stage other than `'render'`.

  ### RenderCtx scope tightened

  `RenderCtx` was already render-stage-scoped at registration; it now also
  checks at resolve time that the active set is `RenderSet.Render` (the only
  set where the pass encoder is open). Using it in Extract / Prepare / Queue
  / PhaseSort / Cleanup throws a clear error naming the set.

  ### World.clearAllEntities()

  New public method on `@retro-engine/ecs`. Despawns every live entity,
  drains the removed-component buffer, resets `nextEntityId`. Used by the
  render world's per-frame auto-clear; documented as the canonical reset
  path for ephemeral worlds.

  ### API surface (additive, backwards-compatible)

  - `App.renderWorld: World` — second world instance.
  - `RenderSet` const-namespace + `RenderSetName` type.
  - `AddSystemOptions.set?: RenderSetName`.
  - `Extract<T>(inner: Param<T>): Param<T>` — main-world param wrapper.
  - `World.clearAllEntities(): void`.
  - `ResolveCtx.renderSet?: RenderSetName` (visible to custom param authors).

  ### Known sharp edges (deferred to follow-up ADRs)

  - Cross-world change-detection ticks (`Extract(Query([T], { changed: [T] }))`
    compares main-world rows against a render-world tick).
  - `Commands` targets the main world from any stage; render-stage spawns go
    through `app.renderWorld.spawn(...)` directly.
  - Observers / lifecycle hooks are App-scoped (fire for both worlds).
  - `ExtractResource<T>` / `ExtractComponent<T>` sugar.

  ### ADR provenance

  - Seals ADR-0019.
  - Builds on ADR-0018 (HAL resources, bindings, render targets, milestone A).
  - Resolves the "render-world implementation" open question in
    `docs/roadmap/renderer.md`.
  - Foundation for Phase 2 (cameras + view), Phase 5 (render graph), and
    every subsequent renderer phase.

- 8934a75: System param protocol: `App.addSystem` now takes a tuple of param tokens plus a value-receiving function, with optional `runIf` run condition. Sealed as ADR-0006.

  - `packages/engine` exports `Param`, `ResolveCtx`, `SystemId`, `RenderCtx`, `Res`, `RunCondition`, `ParamValues`. Phase 1 ships `RenderCtx` (stage-scoped to `'render'`) and `Res(ctor)` against a minimal resource registry on `App` (`insertResource`, `getResource`).
  - `SystemFn` and `RenderSystemFn` types removed; the old `addSystem` overload pair is replaced by one signature: `addSystem(stage, params, fn, options?)`.
  - `packages/ecs` removes the unused `System` type alias.

  Migration: `addSystem('startup', () => {...})` → `addSystem('startup', [], () => {...})`. `addSystem('render', (world, ctx) => {...})` → `addSystem('render', [RenderCtx], (ctx) => {...})`.

- 2beee52: feat(engine): Transform + Hierarchy with propagation (M2 phase 7)

  Adds the engine's core spatial primitives:

  - `Transform` — single component carrying `translation: Vec3`, `rotation: Quat`, `scale: Vec3`. Required Components auto-attaches a `GlobalTransform`.
  - `GlobalTransform` — world-space `Mat4` written each `'postUpdate'` by the engine's propagation system. Auto-registered in the `App` constructor (mirroring the `Time` tick auto-registration).
  - `Parent` / `Children` — hierarchy edges; the propagation system reads `Parent` only, `Children` is maintained for ergonomic queries.
  - `EntityCommands.withChildren((parent) => parent.spawn(...))`, `.addChild(child)`, `.removeChild(child)`, `.despawnRecursive()` — hierarchy-building sugar on the `Commands` API.
  - `CommandsHandle.spawn(...)` now returns `EntityCommands` (was `Entity`); the entity id remains accessible via `.id`. Required so `cmd.spawn(...).withChildren(...)` chains naturally.

  Propagation is depth-sorted by parent walk, single-threaded, recomputed every `PostUpdate`. Orphan children (`Parent.entity` is dead) and `Parent`-chain cycles are handled gracefully via `Logger.devWarn` — no crashes, no silent corruption.

  In `@retro-engine/ecs`: adds `Query.entries()` yielding `[Entity, ...row]`, the entity-id-bearing variant of the standard query iterator. Used by the propagation system; available to any consumer needing entity ids alongside component data.

  Sealed in ADR-0010.
