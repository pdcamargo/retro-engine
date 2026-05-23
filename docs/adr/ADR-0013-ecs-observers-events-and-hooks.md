# ADR-0013: ECS Observers, Events, and Component Hooks

- **Status:** Accepted
- **Date:** 2026-05-22

## Context

ADR-0009 landed the per-system deterministic Commands flush. ADR-0012 landed pull-based change detection: per-row tick columns, `Changed<T>` / `Added<T>` query filters, `RemovedComponents<T>` param, per-system pre-run tick snapshot, frame-boundary drain of the removed buffer. The pull half is enough for systems that ask "what changed since I last ran" but leaves the push half open: there is no way to fire an event and have subscribers react, no way for a component to declare lifecycle behaviour ("when I'm added, register me with the render extractor"), and no frame-buffered channel for fire-and-forget messages.

Bevy is the prior art. The shape of Bevy's reactive layer is well-trodden — `Message<T>` for frame-buffered events, `Event<T>` + `Trigger<E>` for synchronous observed events, component hooks (`on_add` / `on_insert` / `on_replace` / `on_remove`) for component lifecycle — and Bevy 0.17 renamed legacy `Event<T>` to `Message<T>`, reserving `Event` for the trigger/observer surface. We adopt the post-rename vocabulary from day 1 so no later migration burden falls on consumers of this engine.

Downstream consumers blocked on this slice: scenes/prefabs (observers bind inline at scene load), recursive despawn migrated to an `onRemove(Parent)` hook (replaces the manual `Children` walk in `commands.ts`), asset hot-reload (an observer reacts to asset-version changes), and the render extractor (a hook attaches GPU-side state when a `Sprite` is added). Single-threaded throughout, matching every other M2/M3 decision.

## Decision

Three concerns, three engine-package modules, sealed by sixteen numbered design calls below.

### 1. `Message<T>` storage — single-buffer with frame tick stamps + frame-boundary drain

A per-type buffer on `App` (`Map<MessageType, MessageEntry[]>`, where `MessageEntry = { payload, tick }`) accepts writes and yields reads filtered by `tick > lastSeenTick`. Drained at the end of `App.advanceFrame` immediately after `world.drainRemovedBuffer()`. Mirrors the existing `RemovedComponents` machinery exactly, so the reactive primitives compose under one uniform model: a system's `ResolveCtx.lastSeenTick` is the cursor against every per-frame stream (component change ticks, removal entries, message entries).

Bevy's double-buffer (current + previous frame) was the alternative. We rejected it: the lastSeenTick filter already gives Bevy's "see every message since my last run" semantics from one buffer with frame-boundary drain. The `runIf`-gated-reader hazard that ADR-0012 §4 documents for `RemovedComponents` applies verbatim — a reader gated off across a frame may miss that frame's messages. Documented, not blocking, recoverable later to tick-based retention (drain only entries older than the minimum lastSeenTick across all readers) when a real consumer pulls.

### 2. `MessageWriter<T>` / `MessageReader<T>` shapes — tick-cursor via `ResolveCtx.lastSeenTick`

`MessageReader<T>(ctor)` resolves to `Iterable<T>`, filtering the type's entries by `tick > ctx.lastSeenTick` and yielding payloads in registration order. Mirrors `RemovedComponents` resolution exactly. `MessageWriter<T>(ctor)` resolves to `{ write(msg: T): void }`; each `.write(...)` advances the world's mutation tick (see §3) and pushes a new entry with the fresh tick. There is no per-system cursor map: the existing tick-snapshot pattern (`schedule.ts` records each system's pre-run snapshot, threads it into `ResolveCtx`) is doing the work for free.

### 3. World tick is advanced on message write — `World.advanceTick()`

Messages reuse the world's mutation tick so the lastSeenTick filter works uniformly. `World.advanceTick(): number` is exposed as a new public method (additive to ADR-0012's surface): bumps the internal counter and returns the new tick, without writing any tick column or pushing a removed entry. `MessageWriter.write` calls it once per message so the stamped tick is strictly greater than any reader's prior pre-run snapshot, eliminating the "reader's lastSeenTick == message tick → reader misses message" edge case that would otherwise hit when a system writes messages but does no structural mutations.

Bumping the tick on each write does not interact with `Changed<T>` / `Added<T>` queries: messages do not touch any archetype's tick columns, so the per-row predicates are unaffected. The counter is a JavaScript `number` (safe up to 2⁵³) — no overflow concern at any realistic event rate.

### 4. Drain timing — end of frame, after every stage

`App.advanceFrame` calls `messageRegistry.drainAll()` immediately after `world.drainRemovedBuffer()`. Every reader that runs in frame F sees the writes from frame F's writers; the buffer is empty by frame F+1. Matches Bevy's classic semantics and the existing `removedBuffer` cadence. The runIf-gated-reader hazard from §1 is the only documented limitation.

### 5. Message registration — explicit `app.addMessage(Foo)`

Writers against an unregistered type throw at flush time. Aligns with Bevy 0.17+. Auto-registration on first write would silently mask "I forgot to wire my plugin's message types into the app," which is exactly the kind of bug an explicit gate exists to surface. Plugins call `app.addMessage(ctor)` at `build()` time.

### 6. Writer method name — `.write(msg)`

Bevy 0.17+ vocabulary. We pick the surface name fresh; there is no reason to ship the deprecated `.send` and migrate later.

### 7. `Event<T>` trigger surface — both global and entity-targeted, dispatches at the commands flush (not at call site)

`commands.trigger(event)` enqueues `{ kind: 'triggerGlobal', event, depth: D }`. `commands.entity(e).trigger(event)` enqueues `{ kind: 'triggerEntity', event, target: e, depth: D }`. The dispatcher in `applyCommandOp` gains two new arms that walk the observer registry — entity-targeted observers for the target entity first, then globals — and invoke matching observers in registration order. Firing at the flush, not at the call site, is the only choice consistent with ADR-0009 §1's per-system flush ordering: call-site dispatch would let an observer's mutations sneak in mid-system before that system's own commands flush, breaking the deterministic-flush contract.

### 8. Observer registration shape — `app.addObserver([Trigger<E>, …otherParams], fn)`

Mirrors `App.addSystem`'s `(stage, [params], fn)` shape. The first param is conventionally `Trigger<E>(eventCtor)`, but the system-param protocol does not special-case it — observers are systems, and `Trigger<E>` is just one more `Param<T>` resolved via `ResolveCtx`. Entity-targeted variant: `commands.entity(e).observe([Trigger<E>], fn)` enqueues an `attachObserver` op so registration lands deterministically at flush, not synchronously inside the system's body (matches the spawn / insert pattern).

### 9. `Trigger<E>` param shape — accessor methods, not a destructure literal

`Trigger<E>(ctor)` resolves to `{ event(): E; entity(): Entity | undefined }`. Methods over `{ event, entity? }` because the surface is forward-stable: adding `trigger.propagate()` (event propagation up the hierarchy) or `trigger.depth()` (re-entrant depth introspection) is additive on methods, breaking on destructure. Targeted vs broadcast is `trigger.entity() !== undefined`. Matches Bevy.

### 10. Re-entrant triggers — queue in same flush, depth limit 8, devWarn-and-drop on overflow

An observer body that enqueues `commands.trigger(B)` queues the trigger op into the same per-system commands buffer. The buffer's main loop (`for (const op of buf)`) advances to newly-pushed ops after the current op completes, so observer chains fire in the same flush, after the current observer body returns.

Each trigger op carries a `depth: number` field. The dispatcher sets `app.currentTriggerDepth = op.depth` before invoking observers; the commands handle's `trigger()` method reads `currentTriggerDepth` and stamps the new op with `depth: currentTriggerDepth + 1`. When the dispatcher would invoke an observer at depth > 8, it logs `logger.devWarn` once per overflowing event type and drops the op without firing. Bevy's default depth limit is 8; we lock the same. devWarn-and-drop matches the engine's existing devWarn idiom (`commands.ts` for dead-entity insert, hierarchy ops); throw is too aggressive for a runtime hot path.

### 11. Observer-vs-hook ordering — observers before hooks

For any lifecycle event that fires both observers and component hooks, observers run first. Bevy 0.16+ ordering. v1 of this engine ships hooks for lifecycle events and observers for general triggers; the lifecycle-as-trigger sugar (Bevy's `Event<OnAdd<T>>` etc.) is deferred to the follow-up slice where the recursive-despawn migration consumes it. Locking the ordering rule here means that follow-up slice is a pure consumer — it does not re-open this ADR.

### 12. Component hook declaration — both class-static and plugin-side registry

Mirrors the existing `static requires` discovery pattern (`archetype.ts:139–159`) for the static side:

```ts
class Sprite {
  static onAdd(ctx: HookCtx<Sprite>): void { /* … */ }
}
```

Plugin-side via `app.registerComponentHook(Sprite, 'onAdd', fn)` for cross-cutting hooks (a render plugin attaches GPU cleanup to a third-party component without owning the class). Single dispatch call site in the commands dispatcher: fires the static method first (if defined), then iterates the plugin-side registry in registration order. Both surfaces feed one resolution path; consumers do not see the split.

### 13. Hook timing relative to Commands flush — fires during the flush of the triggering mutation

Each `applyCommandOp` arm that mutates an entity dispatches hooks inline. For `onAdd` / `onInsert`: after the underlying `World.*` mutation lands (storage already reflects the new component). For `onReplace`: before the in-place overwrite (the old value is still in storage, so the hook can read it). For `onRemove`: before the structural mutation (the about-to-be-removed value is still in storage). The dispatcher arm completes only after its hooks return, then the buffer loop advances. Multiple mutations within one flush each see world state consistent with their flush position — ADR-0009 §1's per-system flush ordering guarantee extends through hooks unchanged.

### 14. DeferredWorld analog — v1 simplification: `World` + `Commands` in the hook ctx, no wrapper class

The hook receives a frozen-shape context:

```ts
interface HookCtx<T> {
  readonly world: World;
  readonly commands: CommandsHandle;
  readonly entity: Entity;
  readonly value: T;
}
```

The `commands` handle is keyed to the buffer of the system whose flush triggered the mutation, so re-entrant operations queue into the same flush (and observers/hooks they trigger fire later in the same flush, subject to the depth limit from §10). `world` access is the full surface; direct `world.removeComponent` from a hook body is allowed but documented as the unsafe path (mirrors Bevy's "you can footgun yourself" stance on raw `World` access). A constrained `DeferredWorld` wrapper class is recoverable later if footguns surface in practice — v1 favours the smaller surface area.

### 15. onAdd vs onInsert vs onReplace vs onRemove — full Bevy split, fan-out at despawn

- `onAdd` — fires only when `T` is newly attached to the entity (first time `T` appears). Maps to the `addedTick == changedTick` invariant from ADR-0012 §5.
- `onInsert` — fires on every `insertBundle` pass that touches `T` (both new-add and replace-in-place). Superset of `onAdd`.
- `onReplace` — fires only when `T` was already present and is being overwritten. Disjoint from `onAdd`. Receives the **old** value.
- `onRemove` — fires once per removal, including the per-component fan-out at `despawn` (one `onRemove` call per component the despawned entity carried).

Within a single op arm, dispatch order for a bundle: all `onReplace` hooks first (pre-mutation), then the mutation, then all `onAdd` hooks for newly-added components, then all `onInsert` hooks for the full bundle. Within each phase: static-class-method first, then plugin-side registry entries in registration order.

### 16. propagateTransforms and recursive-despawn migration — surface only this slice; migration deferred

`despawnSubtree` (`commands.ts:135–162`) keeps its manual `Children` walk. ADR-0010 §3 / §7 are unchanged. The follow-up slice that migrates recursive despawn to an `onRemove(Parent)` hook is the natural first consumer of the surface shipped here — it becomes a one-PR consumer change once the hook surface lands. Same pattern as ADR-0012 deferring the `Changed<Transform>` gating of `propagateTransforms` to its own slice.

### Rejected alternatives

- **Double-buffered `Message<T>` storage (Bevy classic, 2-frame slack).** Adds a second buffer and a swap step for slack the lastSeenTick filter already gives. The runIf-gated-reader hazard is identical between single-buffer + tick-filter and double-buffer; double-buffer is more memory for no semantic gain in the single-threaded, deterministic-flush model.
- **Auto-register messages on first write.** Hides the registration mistake instead of surfacing it; turns "I forgot to call `app.addMessage(Foo)`" from an explicit throw into a silent partial-functionality bug. Explicit registration is friction worth paying.
- **`.send(msg)` writer name (Bevy 0.16 legacy).** Forces a future rename when the rest of the ecosystem aligns on `.write`. Pick the post-rename name on day 1.
- **Dispatch triggers synchronously at the `commands.trigger(...)` call site.** Breaks ADR-0009 §1's per-system flush ordering — an observer's mutations would land mid-system, before the calling system's own commands flush. The whole point of the commands buffer is to gate "what the world looks like during a system body" against "what it looks like after the system returns"; trigger dispatch must respect the same gate.
- **`Trigger<E>` as a destructure literal `{ event, entity? }`.** Forward-incompatible with adding fields like `propagate()` later. Method accessors preserve the option.
- **Throw on re-entrant-trigger depth overflow.** Crashes a game in production for what is almost always a logic bug that should warn loudly in dev but not kill the frame. `devWarn` + drop matches the existing engine idiom (`commands.ts` for dead-entity insert).
- **Class-static hooks only (no plugin-side registry).** Forces the hook to live on the class declaration site, which prevents a plugin from attaching behaviour to a third-party component it does not own (e.g. a render plugin can't auto-extract `Sprite` if the Sprite class belongs to a different package). The registry side is necessary for cross-cutting hooks; the class-static side is necessary for component-author-owned behaviour. Both ship.
- **Plugin-side registry only (no class-static hooks).** Forces the component author to wire their own hook through a plugin's `build()` even when the behaviour belongs to the component itself. Static methods are colocated with the class definition; reading `class Sprite { static onAdd(...) {} }` tells the reader the hook exists. Both ship.
- **A constrained `DeferredWorld` wrapper class in v1.** Adds an entire new API surface for a footgun that has not yet manifested in practice. Recoverable later — adopting a `DeferredWorld` is additive on the `HookCtx` shape (the existing `world` field can change type behind the readonly facade). v1 starts with the smaller surface.
- **Migrate recursive despawn to `onRemove(Parent)` in this slice.** Cuts the surface twice: the hook system and a behavioural change to a system every test exercises. Splitting into two slices keeps this one focused on the reactive surface and makes the migration a clean diff against tests that already pass.

## Consequences

**Easier:**

- Plugins can react to component lifecycle without polling: register a hook on `Sprite.onAdd` and the render extractor wires itself in.
- Cross-cutting reactive behaviour (asset hot-reload, scene-load events, gameplay triggers like "on death") composes through observers without subclasses or central event-bus singletons.
- Recursive despawn becomes a one-PR consumer migration in the follow-up slice — replace the manual `Children` walk with a `onRemove(Parent)` registration.
- The reactive layer is complete: pull-based (change detection from ADR-0012) and push-based (this ADR) coexist, and a downstream consumer picks the right tool per case.

**Harder:**

- The commands dispatcher (`applyCommandOp`) gains hook + observer dispatch arms. Existing arms now do more work per mutation (a registry lookup per type), though the lookup is `Map.get` for an empty map when no hooks are registered.
- Plugin-side hook registration is an unbounded-cardinality registry: a long-lived app that registers and never unregisters hooks accumulates entries. v1 has no unregistration API; recoverable when a consumer pulls.
- The `static onAdd` discovery path is reflection-based, not type-checked at the class declaration site. Mis-typing the static method name (`static onAddd`) silently does nothing. Documented in the public TSDoc; a future TypeScript decorator (when decorators stabilise across the toolchain) could enforce it.
- Two counters coexist: the world's mutation tick (now also bumped by message writes) and `Time.frame` (per-frame, drives resource-change detection). When the resource finer-grained change-detection surface lands and bridges resources to the mutation tick, this ADR is superseded for the resource interaction half.

**Accepted trade-offs:**

- Direct `world.spawn` / `world.insertBundle` / `world.removeComponent` / `world.despawn` calls from outside a commands flush do NOT fire hooks or observers in v1. Hooks dispatch lives at the engine/commands layer; world stays app-ignorant. Test code that wants hook coverage uses `Commands` instead of raw world calls. Same decoupling that lets `removedBuffer` live on `World` while `lastSeenTickMap` lives on `App`.
- The runIf-gated-reader hazard from ADR-0012 §4 now also applies to `MessageReader<T>`: a reader gated off for a whole frame loses that frame's messages. Recoverable to tick-based retention later.
- `MessageWriter.write` bumps `world.changeTick`. Systems doing a lot of message writes inflate the tick counter; with a `Number`-typed counter this is not a real concern.

## Implementation

- `packages/ecs/src/world.ts` — public `advanceTick(): number` method (new, additive). Exposes the existing private `bumpTick` for engine-layer consumers (currently `MessageWriter.write`).
- `packages/engine/src/messages.ts` — `MessageEntry`, `MessageRegistry`, `MessageWriter`, `MessageReader`. App wires `addMessage(ctor)` registration and `drainAll()` from here.
- `packages/engine/src/observers.ts` — `Trigger`, `TriggerHandle`, `ObserverRegistry`, `dispatchGlobalTrigger`, `dispatchTargetedTrigger`. Re-entrant depth tracking via `App.currentTriggerDepth`. Entity-targeted observers cleared on entity despawn.
- `packages/engine/src/component-hooks.ts` — `HookCtx`, `HookKind`, `ComponentHookRegistry`, `dispatchAdd`, `dispatchInsert`, `dispatchReplace`, `dispatchRemove`. Static-class-method discovery via reflection, plugin-side via `app.registerComponentHook`.
- `packages/engine/src/commands.ts` — `CommandOp` union gains `triggerGlobal`, `triggerEntity`, `attachObserver`, `attachComponentHook` arms (the last two so registration during a system body lands deterministically at flush). `CommandsHandle.trigger(event)` and `EntityCommands.trigger(event)` / `.observe(params, fn)` surfaces. `applyCommandOp` arms dispatch hooks at the appropriate moment around each world mutation, and dispatch observers from the new trigger arms.
- `packages/engine/src/index.ts` — `App` gains `messageRegistry`, `observerRegistry`, `componentHookRegistry`, `currentTriggerDepth`. Public methods: `addMessage<T>(ctor)`, `addObserver(params, fn)`, `registerComponentHook(ctor, kind, fn)`. `App.advanceFrame` calls `messageRegistry.drainAll()` after `world.drainRemovedBuffer()`. Re-exports `MessageWriter`, `MessageReader`, `Trigger`, `HookCtx`, `HookKind`.
- `packages/engine/src/messages.test.ts`, `packages/engine/src/observers.test.ts`, `packages/engine/src/component-hooks.test.ts` — end-to-end via `App.addSystem` and `app.advanceFrame`, mirroring the existing test pattern.
