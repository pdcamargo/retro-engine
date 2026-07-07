---
'@retro-engine/engine': minor
---

feat(engine): exclusive `world()` systems

ECS ordering depth Phase 4 (ADR-0160). A `world()` system param resolves to the
stage's live `World` for immediate structural edits — spawn / despawn / insert /
remove that take effect mid-system, with same-frame read-back — instead of
deferring through `Commands`:

```ts
app.addSystem('startup', [world()], (w) => {
  const player = w.spawn(new Transform());
  w.insertBundle(player, [new Health(100)]);
});
```

A system carrying `world()` must declare no other params (it holds the whole
world); registration throws otherwise, via a new optional `Param.exclusive` flag.
The single-threaded runner needs no scheduling change; the flag is the seam a
future parallel scheduler would read to run such systems alone. `Commands`
remains the default for gameplay — `world()` is the deliberate escape hatch.
