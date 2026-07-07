---
'@retro-engine/engine': minor
---

feat(engine): batch system registration + `.chain()` ordering

First slice of ECS ordering depth (ADR-0157). Adds `App.addSystems(stage, specs,
{ chain })` and the `system(params, fn, options?)` spec helper, so a group of
systems can be registered together and — with `{ chain: true }` — run in strict
sequence:

```ts
app.addSystems('update', [
  system([ResMut(Input)], readInput),
  system([Res(Input), ResMut(Velocity)], applyInput),
  system([Res(Velocity), ResMut(Transform)], integrate),
], { chain: true }); // readInput → applyInput → integrate
```

Chaining orders by **system identity** (a new internal `afterIds` edge on the
schedule), so it composes with any `label` / `before` / `after` the systems
already carry — unlike hand-wiring `after: ['prev-label']`, it doesn't consume a
system's one label slot and can't false-cycle on shared labels. The topo sort
resolves label and id edges in one pass; cycles are still caught eagerly at
registration.
