# ADR-0010: Transform and Hierarchy

- **Status:** Superseded in part by [ADR-0014](ADR-0014-recursive-despawn-via-component-hooks.md) (§3 despawn semantics, §7 `despawnRecursive` mechanics)
- **Date:** 2026-05-22

## Context

After phases 1–6 the engine has the param protocol, a resource registry, `Time`, the archetype world with Required Components, the schedule with states / run conditions / fixed timestep, and the per-system `Commands` buffer. Each of those phases shipped with concern-scoped tests but no single consumer that exercises every prior phase end-to-end. Phase 7 is that consumer: a `Transform` component and a hierarchy that propagate through the world each frame, building on every M2 surface.

Bevy ships `Transform` as a single component with `translation: Vec3`, `rotation: Quat`, `scale: Vec3` — usable for 2D (z=0, Z-axis quaternion) and 3D without a separate type — paired with a `GlobalTransform` written by a propagation system, and `Parent` / `Children` to wire the graph. We adopt that shape directly; a `Transform2D` intermediate would only produce work to refactor away later (per the original backlog at `docs/backlog/transform-hierarchy.md`).

The renderer-HAL constraint is load-bearing for the scope of this phase. `renderer-core` exposes pipeline + pass + shader-module + command-encoder + submit, and nothing else. There is no `createBuffer`, `createBindGroup`, `writeBuffer`, or `setVertexBuffer`. `RenderPassEncoder.setBindGroup` throws `'setBindGroup not implemented yet — bind groups arrive with sprite rendering'`. A visually `Transform`-positioned playground triangle therefore cannot ship in phase 7 — it requires uniform-buffer plumbing that belongs to the sprite-rendering phase. The witness in this phase is component-level (entity carries `Transform`, propagation observed via a debug system + tests); visual propagation is deferred to the renderer-HAL work that lands with sprites.

Single-threaded throughout. No parallel propagation, no worker offload.

## Decision

### 1. Package boundary — `packages/engine`

`Transform`, `GlobalTransform`, `Parent`, `Children`, the propagation system, and the hierarchy-building `Commands` sugar all live in `packages/engine`. Math is already a runtime dep of engine (`@retro-engine/math` is in `packages/engine/package.json`); `Transform`'s public ctor surfaces `Vec3` / `Quat` types into engine's public API regardless of which package owns the class, so the "math leakage at the engine boundary" concern is a fact of `Transform`'s shape, not an artefact of placement. Splitting transform into a sibling `@retro-engine/transform` would force `engine -> @retro-engine/transform` to be able to extend `EntityCommands` with `.withChildren` / `.addChild` — extra package overhead with no isolation win at our scale. Reconsider if a transform-adjacent ecosystem (animation, scene-graph features) accretes enough that a separate package isolates meaningful surface.

### 2. `GlobalTransform` storage — precomputed `Mat4`

`GlobalTransform` holds a single 16-float column-major `Mat4` (`wgpu-matrix`'s default). The propagation system composes local TRS into a matrix and multiplies with the parent's `GlobalTransform.matrix`. Future GPU extract reads `globalTransform.matrix` directly with zero further composition. The "TRS keeps tweening legible" counter-argument is weak: tweens animate the *local* `Transform` where the `Vec3` / `Quat` fields already live, and propagation re-derives `GlobalTransform` from the tweened local each frame — there is no use case where `GlobalTransform` is interpolated as TRS.

### 3. Despawn semantics — explicit `EntityCommands.despawnRecursive()`

`cmd.entity(e).despawn()` stays single-entity; this preserves the phase-6 contract (ADR-0009) — `.despawn()` is *the* despawn op, no cascade. A new `cmd.entity(e).despawnRecursive()` walks the `Children` subtree at flush time and despawns every descendant plus the root. Reasoning: destructive operations should be explicit; observers (Bevy's `OnRemove<Parent>` model) are M3 territory and will revisit auto-cascade with proper machinery in place.

The propagation system handles orphaned children gracefully: if a child's `Parent.entity` is no longer live (despawned, but the child was not cascaded), the child is treated as an effective root for that frame, and `app.logger.devWarn` fires once per offending entity per frame. No crash, no silent corruption.

### 4. Propagation strategy — depth-sort by parent walk

The propagation system, registered automatically in `'postUpdate'`, runs this each frame:

1. Iterate every entity carrying `Transform` + `GlobalTransform`. For each, compute its depth via a memoised walk up the `Parent` chain. A cycle (visited-set hit) is reported via `devWarn` and the offending entity is treated as a root (depth 0). A dead parent (parent entity not live, or live but missing `Transform` / `GlobalTransform`) is reported via `devWarn` and the entity is also treated as a root.
2. Sort entities by depth ascending.
3. For each entity in depth order:
   - If depth 0 (true root or effective root): `composeTransformInto(globalTransform.matrix, translation, rotation, scale)`.
   - Else: compose local TRS into a scratch matrix, then `mat4.multiply(parentGlobal.matrix, scratch, globalTransform.matrix)`.

`Children` is still maintained by the `Commands` sugar so user code that reads `world.getComponent(parent, Children)` sees a coherent list, but propagation *does not depend on `Children`*. Trade-off accepted: O(N log N) for the sort over O(N) for a DFS-from-roots traversal. We pick depth-sort because `Children` may legitimately go stale between a single-entity despawn and the next propagation tick, whereas `Parent` is each child's own component and is always accurate to the child's intent.

### 5. Dirty tracking — recompute every `PostUpdate`

v1 recomputes every `GlobalTransform` from scratch in every `PostUpdate`. No `Changed<Transform>` gating. The ECS's `tickColumns` are already wired for future per-component change detection (ADR-0005), but component-level `Changed<T>` is explicit M3 scope (see `docs/roadmap/change-detection.md` — pending). Recompute-everything is correct, simple, and microsecond-cheap at typical N (≤ 10k entities) on commodity hardware. M3 will introduce the `Changed<Transform>` gate alongside the broader change-detection mechanism.

### 6. `cmd.spawn(...)` returns `EntityCommands`

The hierarchy-building syntax `cmd.spawn(...).withChildren((p) => p.spawn(...))` requires `.spawn()` to return a chainable builder, not a bare `Entity`. Phase 7 changes `CommandsHandle.spawn(...)` from returning `Entity` to returning `EntityCommands`; the entity id remains accessible via `.id`. The underlying entity-id reservation flow (`World.reserveEntity()` / `World.spawnReserved()`) is unchanged. ADR-0009 is **not** superseded — it constrains per-system flush, FIFO ordering, and `cmd.flush()` absence, not this return type. Existing in-repo callers are updated in the same patch; both spawn ops still apply at the same flush point with the same semantics.

### 7. `withChildren` / `addChild` / `removeChild` mechanics

`EntityCommands` gains four methods:

- `withChildren(cb: (parent: ChildBuilder) => void): EntityCommands` — captures the parent's reserved id, invokes `cb` with a `ChildBuilder`. The builder's `spawn(...)` reserves a child id (via `cmd.spawn`) and enqueues an `appendChild(parentId, childId)` op. The `ChildBuilder.spawn` return is a normal `EntityCommands`, so nesting `withChildren` for grandchildren composes naturally.
- `addChild(child: Entity): EntityCommands` — enqueues `appendChild(this.id, child)`. The apply step detaches `child` from any prior parent's `Children` list, sets `child.Parent = this.id`, and appends `child` to `this.id`'s `Children` (creating the `Children` component if absent).
- `removeChild(child: Entity): EntityCommands` — enqueues `detachChild(this.id, child)`. The apply step removes `child` from `this.id`'s `Children` list and removes the `Parent` component from `child` (only if `child.Parent.entity === this.id` — defends against races).
- `despawnRecursive(): void` — enqueues `despawnSubtree(this.id)`. The apply step detaches the root from its own parent's `Children` list (if any), walks the subtree via `Children` (worklist; dead descendants skipped silently), and despawns every descendant plus the root.

`Parent` and `Children` are not part of `EntityCommands`'s public type signatures — hierarchy components are an implementation detail of these methods. Consumers do not import `Parent` / `Children` to build hierarchies; they only import them to query for them.

### 8. Auto-registration in `App` constructor

The propagation system is framework-essential, not opt-in. The `App` constructor auto-registers `propagateTransforms` in `'postUpdate'`, mirroring the existing `Time.tick` auto-registration in `'first'` (introduced in phase 3). No `transformPlugin` is exposed; users who want to disable hierarchy propagation entirely would need a custom-built engine, which is outside the v1 surface.

### 9. `Query.entries()` ECS extension

The propagation system needs the entity id alongside each row of `Transform` + `GlobalTransform` (to look up `Parent`, to memoise depth keyed by entity, to log offending entities by id). The current `Query` row shape is `[...components, ...hasFlags]` with no entity id. Phase 7 adds `Query.entries(): IterableIterator<[Entity, ...row]>` and a backing internal `World.iterateQueryEntries(...)`. Additive change; existing `for...of query` iteration is unchanged.

### Rejected alternatives

- **DFS-from-roots via `Children`** — O(N), simpler to read, matches Bevy's sequential variant. Rejected because it silently skips entities orphaned by a single `cmd.entity(e).despawn()` (orphan's true parent is dead, so no live root has them in `Children`, so DFS never visits them). Depth-sort handles the same case as an effective root + `devWarn`. The N log N sort cost is microsecond-cheap at our N.
- **Auto-cascade despawn (Bevy 0.16+)** — `cmd.entity(e).despawn()` would walk `Children` and despawn descendants automatically. Rejected for v1 because it changes phase 6's `.despawn()` semantics from "single entity, atomic" to "subtree, conditional on `Children` presence," which is a sharp edge that observers (M3) should re-address with proper hooks.
- **TRS-only `GlobalTransform`** — store world-space translation/rotation/scale, derive matrix on demand. Rejected: render extracts and any future GPU upload need a matrix; storing TRS and recomputing on read pushes the multiply per consumer per frame.
- **Separate `@retro-engine/transform` package** — see decision 1. Reconsider when a transform-adjacent ecosystem accretes.
- **In-place `Children` mutation outside `Commands`** — bypassing `Commands` for `Children.entities.push(...)` would invalidate the propagation system's depth memoisation only within the system that mutated, and is a footgun against future change detection. v1 says: mutate `Children` via `Commands` sugar (`addChild` / `removeChild` / `withChildren` / `despawnRecursive`). Direct mutations are not policed at runtime, but are explicitly unsupported.
- **`transformPlugin` opt-in** — see decision 8. Auto-registration matches the existing `Time` precedent and avoids a useless "did you remember to add the plugin" foot-gun.

## Consequences

**Easier:**

- Sprites, debug viz, scenes, animation, and any other consumer of world-space coordinates target a single component pair (`Transform` / `GlobalTransform`) with documented update timing (`'postUpdate'`).
- Hierarchies build with one-call ergonomics: `cmd.spawn(...).withChildren((p) => p.spawn(...))`. Bevy's mental model maps over with minor renames.
- The renderer-side story is unblocked: when bind groups arrive in `renderer-core` for sprite rendering, that consumer reads `globalTransform.matrix` directly and uploads to a GPU uniform buffer with no further engine-side work.
- Orphan and cycle handling produce loud-in-dev / silent-in-prod diagnostics through `Logger.devWarn` (ADR-0007), so the failure modes are debuggable without crashing user code.
- Phase 7 is the first end-to-end witness that M2's plumbing — params, resources, archetype world + Required Components, schedule, Commands — composes. Phase 8 (plugin lifecycle) lands on top of a known-coherent base.

**Harder:**

- The `cmd.spawn(...): EntityCommands` return-type change is a surface change to phase 6's `Commands` API. The runtime behavior is unchanged (reserved id + deferred spawn op), but every call site that assigned `cmd.spawn(...)` to a variable of type `Entity` now needs `.id`. In-repo migration is bounded (the test suite plus the playground); external consumers do not exist yet (we are pre-0.1.0).
- Propagation recomputes every `GlobalTransform` every frame. At extreme N (≥ 100k entities) this becomes measurable and `Changed<Transform>` gating will be required. M3 ships that gate. The decision is to pay the cost in v1 rather than premature-optimise.
- `Children` is now maintained in two places: by `Commands` sugar (the recommended path) and, in principle, by direct user mutation through `world.getComponent(parent, Children)?.entities.push(...)`. The propagation system tolerates stale `Children` (it depends only on `Parent`), but user code that reads `Children` could see stale entries. The recommended path is documented; we do not police it at runtime.

**Accepted trade-offs:**

- Depth-sort propagation is O(N log N) for a use case where O(N) DFS would suffice if the data were perfectly maintained. The N log N cost buys correctness under orphan-after-single-despawn, which is a real failure mode the safer-correctness branch covers cleanly.
- The playground does not visually witness `Transform` in this phase. The component-level witness (debug-log system) is correct but less dramatic. Visual witness ships with sprites.
- ADR-0009's `cmd.spawn(...): Entity` API surface changes here. ADR-0009 is not superseded — its decision scope is flush semantics and the absence of a per-handle `flush()`, not the spawn return type — but the surface diff is real and called out in decision 6 above.

## Implementation

- `packages/engine/src/transform.ts` — `Transform`, `GlobalTransform`, `composeTransformInto` (internal helper).
- `packages/engine/src/hierarchy.ts` — `Parent`, `Children`, `ChildBuilder` (type alias for the `withChildren` callback param), `propagateTransforms` (registered automatically in `'postUpdate'` by `App` constructor).
- `packages/engine/src/commands.ts` — `CommandsHandle.spawn(...): EntityCommands`. `EntityCommands.withChildren`, `EntityCommands.addChild`, `EntityCommands.removeChild`, `EntityCommands.despawnRecursive`. `CommandOp` variants: `appendChild`, `detachChild`, `despawnSubtree`.
- `packages/engine/src/index.ts` — public re-exports of `Transform`, `GlobalTransform`, `Parent`, `Children`. Auto-registration of `propagateTransforms` in the `App` constructor.
- `packages/engine/src/transform.test.ts`, `packages/engine/src/hierarchy.test.ts` — concern-scoped test coverage (TRS compose, `Required: [GlobalTransform]` auto-attach, root propagation, parent-child propagation, deep-chain propagation, reparent, recursive despawn, orphan handling, cycle detection).
- `packages/engine/src/commands.test.ts` — updated for `cmd.spawn(...): EntityCommands` return type; new tests for hierarchy sugar.
- `packages/ecs/src/query.ts` — `Query.entries(): IterableIterator<[Entity, ...row]>`.
- `packages/ecs/src/world.ts` — internal `iterateQueryEntries(...)` backing the new method.
- `packages/ecs/src/index.test.ts` — coverage for `Query.entries()`.
- `apps/playground/src/triangle-plugin.ts` — spawns the triangle as a `Transform`-bearing entity with a child via `withChildren`. Adds a debug system in `'postUpdate'` that logs the propagated `GlobalTransform.matrix` once per second. Hardcoded WGSL stays; visual GPU integration arrives with sprite rendering.
