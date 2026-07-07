---
'@retro-engine/engine': minor
---

feat(engine): set-level run conditions

Completes system sets (ECS ordering depth Phase 2b, ADR-0158). `App.configureSet`
now accepts a `runIf`, gating every member of the set:

```ts
app.addSystem('update', [...], stepAI, { inSet: 'gameplay' });
app.addSystem('update', [...], stepPhysics, { inSet: 'gameplay' });
app.configureSet('update', 'gameplay', { runIf: inState(GameState.Playing) });
```

A member runs only when its own `runIf` (if any) **and** every set it belongs to
pass; multiple conditions on one set are AND-ed. The check runs through a shared
`setConditionsPass` applied in both the main-stage runner and the render-stage
runner, so the gate has no half-coverage, and is allocation-free on the hot path.
