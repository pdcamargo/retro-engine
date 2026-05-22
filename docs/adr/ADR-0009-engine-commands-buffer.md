# ADR-0009: Engine Commands Buffer

- **Status:** Accepted
- **Date:** 2026-05-22

## Context

Structural mutations to the archetype world — spawn, despawn, add or remove a component — move entity rows between archetypes via swap-remove. A system iterating a `Query` cannot perform these mutations mid-loop without invalidating the iterator: the archetype it is walking can grow or shrink, and rows can swap into positions the iterator has not yet visited (or out of positions it already has). Bevy's answer is `Commands`: a deferred-mutation buffer that systems write to during iteration, drained at well-defined sync points.

The system-param protocol (ADR-0006) anticipates `Commands` by exposing `SystemId` in `ResolveCtx`, on the explicit understanding that this phase would key per-system buffers off it. The schedule, states, and run conditions (ADR-0008) sealed deterministic, single-threaded, topologically-ordered system execution within each stage. With both in place, the remaining decisions for the Commands buffer are: where buffers live, when they flush, what storage primitives the buffers call into, and what guarantees consumers can rely on.

The original backlog spec listed an explicit user-facing `cmd.flush()` method. This ADR intentionally drops it from the public handle — see decision 3 — because per-system flush plus topo ordering makes the in-system mid-stage visibility case both redundant for well-structured code and a footgun for code holding live query iterators. An `App`-level `flushCommands()` covers orchestration callers (tests, plugin lifecycle, scripted scene loading) where the iterator hazard does not apply.

Single-threaded throughout. No parallel scheduling, command-queue workers, shared-memory primitives, or atomics.

## Decision

### 1. Per-system flush granularity

`Commands` buffers are keyed by `SystemId` and flushed **immediately after the owning system's function returns**. The stage runner (`schedule.ts: runStage`), the state-transition driver (`state.ts: invokeStateSystem`), and the render-stage loop (`index.ts: renderFrame`) each call `app.flushSystemCommands(sys.id)` after invoking the system's function. The fixed-loop driver requires no additional hook — it calls `runStage` five times per substep, and the per-system flush nested inside `runStage` covers every fixed-stage system.

This is strictly stronger than the backlog spec's "end of each stage" requirement: the last system in a stage flushes when it returns, which is also the moment the stage ends. The stronger guarantee — every system in a stage observes the prior system's flushed mutations — falls out of single-threaded execution plus deterministic topological order (ADR-0008 §10), and costs no additional machinery.

Systems skipped by a `runIf` gate do not flush; they never enqueued.

### 2. Entity-id reservation via `World.reserveEntity` / `World.spawnReserved`

`cmd.spawn(...)` returns an `Entity` synchronously — the caller can pass it to a sibling op in the same buffer, store it in a component, or hand it to a later system. To make this possible without allocating archetype storage at enqueue time, `World` exposes two primitives:

```ts
World.reserveEntity(): Entity;
World.spawnReserved(entity: Entity, components: readonly object[]): void;
```

`reserveEntity` mints `nextEntityId++` and returns it. The reserved id is not in `entityIndex`, so `world.has(id, T)` returns `false` and queries do not see it until `spawnReserved` allocates the row. `spawnReserved` resolves the bundle (running `static requires`) and pushes into the matching archetype; it throws if the id is already live — the only reachable cause is a Commands-internal bug (double-spawn op).

Reserved-but-never-spawned ids leak forever, matching the existing "no generation counter, no id recycling" property of the ECS (ADR-0005). Acceptable here because every `cmd.spawn` is followed by a spawn op in the same buffer that flushes within the same stage.

### 3. Deterministic ordering contract, no user-facing `cmd.flush()`

Within a single buffer flush, operations apply in the order they were enqueued (FIFO over the buffer array). Across systems within a stage, system execution order — sealed by ADR-0008 §10's per-stage `topoSort` — determines flush order. Because each system flushes immediately on return, the contract is equivalently stated as: the world a system observes is exactly the world produced by every prior system's flushed buffer.

The `CommandsHandle` returned to systems carries **no `flush()` method**. This diverges from the original backlog spec. Rationale: exposing flush on the per-system handle re-opens the foot-gun `Commands` exists to close — a system holding a live `Query` iterator that calls `flush()` mid-loop can break the iterator. Same-system "see my own writes" needs are satisfied either by splitting into two systems with `before` / `after` ordering, or by calling `world.spawn` / `app.insertResource` directly (which bypass Commands entirely and explicitly opt out of iteration safety).

For genuine orchestration use cases — test setup, plugin lifecycle hooks, scripted scene loading — `App.flushCommands()` is the public escape hatch (see decision 5).

### 4. Resource change-frame timing at flush

`cmd.insertResource(value)` and `cmd.removeResource(ctor)` enqueue ops only; at flush, they dispatch through `App.insertResource` and `App.removeResource`, which already write `resourceChangeFrames.set(key, Time.frame)` (per ADR-0008 §9). The change frame stamped is therefore the frame in which the flush runs — not the frame the op was enqueued. `resourceChanged(R).test(app)` consequently fires for systems gated on a resource that an earlier same-stage system inserted through `Commands`.

### 5. Per-system buffer storage and `App.flushCommands`

Buffers live on the `App` in a `Map<SystemId, CommandOp[]>`. The map is lazy: an empty buffer is `undefined`, not `[]`. The handle calls an internal `App.getCommandsBuffer(systemId)` accessor on first write, which lazy-inits and returns the array.

Two `App` methods drain buffers:

- `App.flushSystemCommands(id: SystemId): void` — `@internal`. Called by the stage runner, state-transition driver, and render-stage loop. Drains one system's buffer: deletes the map entry **before** iterating ops (so any re-enqueue during apply starts a fresh buffer with no recursive replay), then applies each op in order.
- `App.flushCommands(): void` — **public**. Iterates `commandsBuffers.keys()` in insertion order and calls `flushSystemCommands` on each. Intended for orchestration code, tests, and plugin lifecycle hooks. Calling from within a system's function while a `Query` iterator over the same world is live is undefined behavior — split into two systems with `before` / `after` instead.

The `Commands` `Param` is a singleton object (per ADR-0006's interning rules — no per-type key, no `WeakMap` cache); `resolve(ctx)` constructs a fresh `CommandsHandle` per invocation, wrapping `(ctx.app, ctx.systemId)`. The handle has no `flush()` method.

### 6. Failure handling

- **Dead-entity `insert`** (entity not in `entityIndex` at flush — despawned by an earlier op in the same buffer, by an earlier system, or in a previous frame): the flush handler pre-checks via `world.has(entity, …)` semantics (existence in `entityIndex`), emits `app.logger.devWarn`, and skips the op. The flush continues; subsequent ops in the buffer are applied. `world.insertBundle` is **not** called because it throws on unknown entities, and a throw would abort the rest of the flush.
- **Dead-entity `remove`** — silent, matching `World.removeComponent`'s pre-existing behaviour.
- **Dead-entity `despawn`** — silent, matching `World.despawn`.
- **Spawn-then-despawn in same buffer** — supported. Ops apply in order: spawn allocates storage at the reserved id; despawn swap-removes it. End state: entity is gone, reserved id leaked (same as any despawn).
- **System throws inside `sys.fn`** — the runner discards the partial buffer (`app.commandsBuffers.delete(sys.id)`) and re-throws. Applying half a system's intent is more error-prone than dropping it, and a stale buffer leaking into the next invocation of the same `SystemId` is a latent correctness bug. Applies in `runStage`, `invokeStateSystem`, and the render-stage loop.

### Rejected alternatives

- **End-of-stage flush only** — weaker than per-system flush; leaves systems in the same stage unable to react to a prior system's spawn without an extra explicit flush call. No implementation simplicity over per-system flush.
- **One global command queue shared across systems** — defeats the determinism contract: enqueue order across systems becomes interleaved rather than topologically grouped.
- **`cmd.flush()` on the per-system handle** — see decision 3. Foot-gun against live query iterators.
- **Deferring entity-id mint to flush time** — forecloses the synchronous-`Entity` return from `cmd.spawn`, which sibling ops in the same buffer rely on.
- **Storing buffers on the `Commands` handle itself** — a fresh handle is constructed per resolution; the handle does not survive the system call. Buffers must live where the flusher can find them post-call.

## Consequences

**Easier:**

- A single mental model: "my commands flush when I return". No "stage boundary" rule to memorise — per-system flush subsumes the spec's stage-boundary requirement.
- Phase 7 transform propagation: a parent-spawn followed in the same stage by a propagation system reads a coherent hierarchy without an explicit flush.
- `cmd.spawn(...)` returns an `Entity` synchronously, so hierarchy spawn helpers (`withChildren`) can hand the parent id to the child-spawn callback without async wiring.
- Plugin code can structurally mutate during query iteration freely; the iterator runs on the archetype as it was at the start of the system.

**Harder:**

- The per-system flush guarantee is stronger than Bevy's `ApplyDeferred`-gated model. If/when parallel scheduling appears (not on the M2 roadmap), `Commands` will need explicit sync points and the implicit flush will become per-set rather than per-system; that is a future ADR's problem.
- A reserved-but-never-spawned entity id leaks until the world is dropped. Acceptable in v1 because (a) ids are 53-bit JS-number-safe integers, (b) every reserve is followed by a spawn op in the same buffer that flushes within the same stage. If a future API exposes reserve outside of `Commands`, that ADR must address recycling.

**Accepted trade-offs:**

- Divergence from the original backlog surface: no user-facing `cmd.flush()`. The orchestration use case is served by `App.flushCommands()`; the same-system mid-stage case is a code-smell whose answer is "split into two systems".
- Dead-entity inserts route through `devWarn` rather than throwing. Throwing would abort the flush mid-buffer and surface a stage-runner exception for a user mistake that is recoverable. `devWarn` is silent in production builds (ADR-0007), loud in dev.
- Per-system `Map` entry costs one `Map.get` per system per frame regardless of whether the system used `Commands`. The lazy-init pattern keeps the cost to a single `Map.get` returning `undefined` for systems that never enqueue.

## Implementation

- `packages/engine/src/commands.ts` — `Commands` param, `CommandsHandle`, `EntityCommands`, internal `CommandOp` union, `applyCommandOp`.
- `packages/engine/src/index.ts` — `App.commandsBuffers`, `App.flushSystemCommands` (`@internal`), `App.flushCommands` (public), `App.getCommandsBuffer` (`@internal`); render-stage loop discard-on-throw + post-flush; public re-exports of `Commands`, `CommandsHandle`, `EntityCommands`.
- `packages/engine/src/schedule.ts` — `runStage` discard-on-throw + post-flush around each `sys.fn`.
- `packages/engine/src/state.ts` — `invokeStateSystem` discard-on-throw + post-flush around each `rec.fn`.
- `packages/ecs/src/world.ts` — `World.reserveEntity`, `World.spawnReserved`; `World.spawn` refactored to compose the two.
- `packages/engine/src/commands.test.ts` — concern-scoped test coverage (spawn-during-iter, despawn-during-iter, multi-system ordering, fixed/state/render flush hooks, dead-entity insert devWarn, throw-discards-buffer, `App.flushCommands` orchestration).
