---
'@retro-engine/engine': minor
---

feat(engine): resource change detection + Changed<Transform>-gated propagation (ADR-0016)

Closes the two deferrals ADR-0012 left open: writer- **and** reader-side resource change detection, plus a `propagateTransforms` that only touches subtrees whose `Transform` or `Parent` actually moved this frame.

### Writer-side: `markResourceChanged`

Symmetric to `world.markChanged(entity, type)` for components. Stamps the resource's change-frame so `resourceChanged` and the new `ChangedRes` observe the mutation. `devWarn` no-op when the resource is not registered.

```ts
class Counter { value = 0 }
app.insertResource(new Counter());

// Outside a system (tests, plugin lifecycle):
app.markResourceChanged(Counter);

// Inside a system body — deferred via the commands buffer:
app.addSystem('update', [Commands, ResMut(Counter)], (cmd, c) => {
  c.value += 1;
  cmd.markResourceChanged(Counter);
});
```

### Reader-side: `ChangedRes` and `ResAdded` params

Parallel-param shape — declared alongside `Res(T)` / `ResMut(T)`, non-breaking. `ChangedRes(T)` resolves to `true` iff the resource's change-frame has moved since the calling system last ran; `ResAdded(T)` resolves to `true` iff the resource was inserted fresh in the same window. Mirrors `RemovedComponents(T)` as a parallel reactivity primitive rather than a wrapper on the resolved value.

```ts
app.addSystem('update', [ResMut(Counter), ChangedRes(Counter)], (counter, didChange) => {
  if (didChange) recomputeExpensiveDerivedState(counter);
  counter.value += 1;
});

app.addSystem('startup', [ResAdded(AudioMixer)], (justAdded) => {
  if (justAdded) primeMixerVoices();
});
```

Cross-frame accumulation works automatically for `runIf`-gated systems — `lastSeenFrame` only advances when the system actually runs, so a mark made during a skipped frame is still visible on the next actual run. The wrapper-style `Res<T>.isChanged()` alternative was considered and rejected; it would have broken every existing `Res` / `ResMut` call site.

### Gated transform propagation

`propagateTransforms` no longer recomputes every `GlobalTransform` from scratch each frame. The new gated pass touches only entities whose `Transform` or `Parent` changed this frame, expanded via BFS over `Children` so a parent's mutation reaches every descendant (the parent-child invariant ADR-0012 §8 flagged). Empty dirty set → early return; no row scan, no depth sort. On the first frame after spawn, every freshly-spawned entity's `Transform.changedTick` is current, so the dirty set covers the full world — same cost as before from frame 1.

Every entity whose `GlobalTransform` is recomputed is reported via `world.markChanged(entity, GlobalTransform)` so downstream consumers can filter:

```ts
// Canonical use: GPU upload pump for dirty world matrices only.
app.addSystem(
  'render',
  [Query([GlobalTransform], { changed: [GlobalTransform] })],
  (dirty) => {
    for (const [_entity, global] of dirty.entries()) uploadWorldMatrix(global.matrix);
  },
);
```

**Direct field writes still need `markChanged`.** Mutating `transform.translation[0] = 5` does not auto-bump `Transform.changedTick`; gated propagation will not pick it up. Follow up with `world.markChanged(entity, Transform)` — same explicit-mark rule that has always applied to `Changed<T>` consumers. The unconditional `propagateTransforms(world, logger)` free function is preserved for ad-hoc full recomputation.

### Correctness fix: in-place reparenting now bumps `Parent.changedTick`

`Commands.appendChild`'s in-place mutation branch (when the child already has a `Parent`) previously assigned `existingParent.entity = newParent` without bumping the tick. Any consumer using `Changed<Parent>` from ADR-0012 phase 1 missed reparenting via `addChild`. Fixed.

### API surface (additive, no breakage)

- `App.markResourceChanged(ctor)` — synchronous writer-side hint.
- `CommandsHandle.markResourceChanged(type)` — deferred writer-side hint.
- `ChangedRes(ctor)` — reader-side `Param<boolean>`.
- `ResAdded(ctor)` — reader-side `Param<boolean>`, parallel to component `Added<T>`.
- `ResolveCtx.lastSeenFrame: number` — added next to `lastSeenTick` (visible to anyone hand-constructing a `ResolveCtx` for custom dispatch).
- Internal: `App.lastSeenFrameMap`, `App.lastSeenFrameOf`, `App.recordSystemLastSeenFrame`, `App.getResourceAddedFrame`, `App.currentFrameNumber` promoted to `@internal` public.

### ADR provenance

- Seals ADR-0016.
- Consumes ADR-0012 §7 (resource change detection) and §8 (`propagateTransforms` gating) — ADR-0012's body stays frozen per CLAUDE.md §3.
- Independent correctness improvement: `Commands.appendChild` in-place reparenting now interoperates with the `Changed<Parent>` surface introduced by ADR-0012 phase 1.
