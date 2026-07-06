---
'@retro-engine/physics-core': minor
'@retro-engine/physics-rapier': patch
---

feat(physics): surface collision start/stop events to ECS

`CollisionEvent` is now a class (was an interface) so it doubles as an ECS message type. `PhysicsPlugin` registers it and, each fixed step, writes the backend's drained collision events to the channel — read them with `MessageReader(CollisionEvent)`:

```ts
app.addSystem('update', [MessageReader(CollisionEvent)], (events) => {
  for (const e of events) if (e.kind === 'started') onHit(e.a, e.b);
});
```

The Rapier backend now creates colliders with `ActiveEvents.COLLISION_EVENTS` so contacts actually report (Rapier is silent otherwise). Verified headless: a falling box lands on the floor and a `started` event is emitted between the two entities. Backends may return plain `{ kind, a, b }` objects — structurally assignable to the `CollisionEvent` class.
