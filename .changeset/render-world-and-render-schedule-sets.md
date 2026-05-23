---
'@retro-engine/engine': minor
'@retro-engine/ecs': minor
---

feat(engine): render world + render schedule sets (ADR-0019)

Closes Phase 1.4 + 1.5 of the renderer roadmap. The engine now hosts a second
`World` for render-only data, plus a six-set sub-ordering inside the
`'render'` stage. Backwards-compatible — existing render-stage systems
default to the `Render` set and keep working unchanged.

### App.renderWorld

A literal second `World` instance, peer to `app.world`. Render-stage system
params resolve against it by default. Cleared at the start of every
`renderFrame()` — entities do not persist across frames, but resources do.

```ts
app.addSystem('render', [Query([ExtractedSprite])], (q) => {
  for (const [s] of q) record(s);
});
```

Read main-world data via the new `Extract<P>` wrapper:

```ts
app.addSystem(
  'render',
  [Extract(Query([Sprite, GlobalTransform]))],
  (q) => {
    for (const [sprite, transform] of q) {
      app.renderWorld.spawn(new ExtractedSprite(sprite, transform.matrix));
    }
  },
  { set: RenderSet.Extract },
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
