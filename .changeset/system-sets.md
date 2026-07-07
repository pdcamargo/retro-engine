---
'@retro-engine/engine': minor
---

feat(engine): named system sets + set-level ordering

Second slice of ECS ordering depth (ADR-0158). Systems can join reusable, named
sets, and a set's ordering is configured once for the whole group:

```ts
app.addSystem('update', [ResMut(Velocity)], integrate, { inSet: 'physics' });
app.addSystem('update', [Res(Velocity)], resolveContacts, { inSet: 'physics' });
app.configureSet('update', 'physics', { after: ['input'] }); // both run after input
```

- `AddSystemOptions.inSet` — a string or string[]; a system can join several sets
  and still carry its own `label`.
- `App.configureSet(stage, set, { before, after })` — set-level ordering expanded
  onto every member; repeated calls merge; cycles are caught eagerly and rolled
  back.
- The topo sort now indexes each system by its `label` **and** its set
  memberships under one name map, so a per-system `before` / `after` target
  matches a set name as well as a label (backward-compatible superset).
- `SystemInfo.sets` surfaces membership in `describeSchedule` for tooling.

Ordering-only and entirely at registration time — no per-frame cost. Set-level
`runIf` is a tracked follow-up.
