# ADR-0019: Render world and render schedule sets

- **Status:** Accepted
- **Date:** 2026-05-23

## Context

Through ADR-0018 the HAL surface is complete, but the engine still runs one fixed pass per frame against a single `World`. Every later renderer-roadmap phase (cameras, materials, sprites, lighting, post-processing, glTF) needs to split CPU data prep from GPU command recording, run multiple sub-phases per camera, and host rendering-only state that doesn't belong on gameplay entities. Bevy solved this with a two-world architecture and a six-set `Render` schedule. We need the same shape — adapted to single-threaded JS and our schedule's `before` / `after` ordering primitive.

`docs/roadmap/renderer.md` Phase 1 §1.4 flagged this as an open question — full second `World` instance, or a logical partition of one. With ADR-0018 landed we now know what extracted data looks like (HAL resources, transforms, render-target references), and the answer for clean schema separation is "two literal worlds."

## Decision

Adopt Bevy's two-world / Render-set shape, scaled down for Phase 1.

- **`App.renderWorld: World`** — a literal second `World` instance, peer to `App.world`. Render-stage system params resolve against it by default. Persistent render-side state lives in *resources* (which `App` owns globally); render-world *entities* do not persist across frames.
- **Render-world auto-clear.** `App.renderFrame()` calls `renderWorld.clearAllEntities()` at the start of every frame, before Extract runs. Matches Bevy's "rebuild from main world each frame" convention. Component lifecycle hooks fire per cleared row (per-component hooks are App-scoped, so the same hook fires for both worlds — authors needing a discriminator add a render-world-only component).
- **`RenderSet` const-namespace** with six values — `Extract → Prepare → Queue → PhaseSort → Render → Cleanup`. `AddSystemOptions` gains an optional `set?: RenderSetName` field, valid only when registering against the `'render'` stage (rejected at registration for any other stage). Systems without an explicit `set` default to `RenderSet.Render`, which preserves the single-pass shape that predates this ADR — the playground triangle continues to work unchanged.
- **`App.renderFrame()` rewrite.** The new loop:
  1. `renderWorld.clearAllEntities()`.
  2. Run pre-pass sets in order: `Extract`, `Prepare`, `Queue`, `PhaseSort`. No encoder, no pass, no `RenderCtx`.
  3. If a surface is present: open the swapchain pass, run the `Render` set with a `RenderContext` in scope, close the pass, submit.
  4. Run the `Cleanup` set. Encoder is finished; no `RenderCtx`.
- **`Extract<P>(inner)` system param** — wraps any `Param<T>` so it resolves against `app.world` (main world) regardless of the outer `ResolveCtx.world`. The inner param's `scope` is preserved (so `Extract(RenderCtx)` is still render-stage only). Read-only by convention; pair with `Res(...)` / `Query([...])` rather than `ResMut(...)`. Used inside Extract-set systems to bridge main-world reads into render-world writes (the system body calls `app.renderWorld.spawn(...)` directly with the extracted data).
- **`RenderCtx` scope tightened.** Stage-scope `'render'` continues to be enforced at registration. At resolve time, `ResolveCtx.render` is set only inside the `Render` set; using `RenderCtx` in Extract / Prepare / Queue / PhaseSort / Cleanup throws a clear error naming the set.
- **`World.clearAllEntities()`** — new public method on `@retro-engine/ecs`. Despawns every live entity, drains the removed-component buffer, resets `nextEntityId`. Documented as the canonical reset path for ephemeral worlds.

Composition-only — `App` gains one field, one method on the world, and one optional `AddSystemOptions` field. No base classes, no abstract render contexts, no plugin sub-app machinery (Bevy's `SubApp` shape is heavier than we need today). Plugins continue to register systems against `'render'` with set tags; no new plugin lifecycle.

## Consequences

**Easier:**

- Phase 2 (cameras) lands cleanly: a `Camera` plugin registers Extract-set systems that copy active cameras + transforms into render-world entities, Prepare-set systems that build per-camera bind groups against the HAL, Queue-set systems that populate per-camera phase items, and a Render-set driver that walks the sorted phases.
- Phase 4 (shader system) and Phase 7 (materials) can host `PipelineCache` / `SpecializedRenderPipeline` / material extraction registries as render-world *resources* — they persist across frames without polluting gameplay world resources.
- Sprite rendering (Phase 8) and any future batched draw path fit the `Prepare → Queue → Render` shape directly. No restructuring needed when the render graph (Phase 5) lands; the graph absorbs the inside of the `Render` set and the surrounding sets stay unchanged.
- Test ergonomics are preserved: existing tests that run `await app.run()` with the rendering renderer keep working. New render-world tests slot in alongside.

**Harder / accepted trade-offs:**

- **Cross-world change detection.** Each `World` has its own `changeTick`; a render-stage system's `lastSeenTick` snapshot comes from `renderWorld.changeTick`. `Extract(Query([T], { changed: [T] }))` therefore compares main-world rows against a render-world tick — semantically wonky. Phase 1 documents this on the `Extract` param and leaves cross-world ticks for a follow-up. Use plain `Extract(Query([T]))` without change filters until then.
- **Commands target the main world.** `CommandsHandle` is keyed by `App`, not by world — `cmd.spawn(...)` from inside a render-stage system flushes into `app.world`. Phase 1 mitigation: render-stage Extract systems call `app.renderWorld.spawn(...)` directly (synchronous, no deferred buffer). A future cross-world `Commands` extension can land without breaking the current API.
- **Observers / lifecycle hooks are App-scoped.** A `Lifecycle.onRemove(Transform)` observer fires for both `app.world` despawns and `app.renderWorld.clearAllEntities()` despawns. Authors who need a per-world discriminator add a render-world-only marker component. World-scoped observers are a future concern.
- **Bevy's extract-boilerplate regret applies.** Each render-stage feature adds an extract pair (read in main, write in render) and a corresponding render-world component schema. Phase 1 ships no `ExtractResource<T>` / `ExtractComponent<T>` sugar — consumers write the extract system explicitly. Sugar can land in a follow-up once we have at least two real consumers to inform the API.
- **Auto-clear cost.** `clearAllEntities()` iterates and despawns each live entity, firing component hooks per row. For Phase 1's expected scale (a handful of cameras + a few hundred extracted entities) this is acceptable; if profiling later shows it as a bottleneck, the path forward is a bulk-archetype-reset variant that bypasses hooks for render-world entities.

## Implementation

- `packages/ecs/src/world.ts` — `World.clearAllEntities()`.
- `packages/engine/src/render-set.ts` — `RenderSet`, `RenderSetName`, `RENDER_SET_ORDER`.
- `packages/engine/src/system-param.ts` — `ResolveCtx.renderSet`; `RenderCtx` error tightened; `Extract<T>(inner)` param wrapper.
- `packages/engine/src/schedule.ts` — `RegisteredSystem.set` field.
- `packages/engine/src/index.ts` —
  - `App.renderWorld: World`.
  - `AddSystemOptions.set?: RenderSetName` + validation in `addSystem`.
  - `App.renderFrame()` rewritten to group systems by set and iterate in order; auto-clears `renderWorld` at the start of every frame.
  - `advanceFrame()` drains `renderWorld`'s removed-component buffer at the end.
  - Public re-exports: `RenderSet`, `RenderSetName`, `Extract`.
- `packages/engine/src/render-world.test.ts` — 13 tests covering world isolation, Extract<P> world swap, set ordering, the default-to-Render-set backwards-compat path, RenderCtx scope rejection, auto-clear, headless-app behaviour, and a full Extract round-trip.
