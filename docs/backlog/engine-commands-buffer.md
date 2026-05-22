# Engine Commands Buffer

- **Created:** 2026-05-21

## Context

Once the World is archetype-backed, structural changes (spawn, despawn, add or remove a component) move entities between archetypes. A system iterating `Query([A, B])` cannot fragment archetypes mid-loop without breaking the iterator. Bevy's answer is `Commands`: a deferred-mutation buffer that systems write to during iteration, flushed at well-defined sync points.

This backlog item adds a **`Commands` system param** that records entity/component mutations into a per-system queue. The engine flushes queues at stage boundaries with deterministic ordering — matching Bevy 0.16's command-queue-flush guarantee so that downstream observer/hook ordering (when those land) is predictable.

```ts
// Approximate surface.
app.addSystem('update', [Commands, Query([Position, Velocity])], (cmd, q) => {
  for (const [pos, vel] of q) {
    pos.x += vel.vx;
    if (pos.x > 1000) cmd.spawn(new Position(0, 0), new Velocity(1, 0)); // queued, not applied
  }
}); // commands flushed at end of 'update' stage

cmd.spawn(component, component, ...);
cmd.despawn(entity);
cmd.entity(entity).insert(component);
cmd.entity(entity).remove(Ctor);
cmd.insertResource(value);
cmd.removeResource(Ctor);
```

Flush points:
- End of each Main stage.
- End of each Fixed stage.
- End of each state schedule (`OnEnter` / `OnExit` / `OnTransition`).
- On demand via `cmd.flush()` (rare — for systems that need the mutation visible to a subsequent operation within the same stage).

Within a flush, operations apply in the order they were enqueued. Across systems within a stage, system registration order determines flush order. This is sufficient for single-threaded execution and matches Bevy's deterministic-flush guarantee.

## Why deferred

M2 phase 6. Depends on the archetype World (phase 4) so structural mutations have a target, on the resource registry (phase 2) for `cmd.insertResource` / `cmd.removeResource`, on the schedule (phase 5) so flush points are well-defined, and on the system param protocol (phase 1) since `Commands` is a system param.

## Acceptance

- `packages/engine` exposes a `Commands` system param.
- Methods covered: `spawn(...components)`, `despawn(entity)`, `entity(e).insert(component)`, `entity(e).remove(ctor)`, `insertResource(instance)`, `removeResource(ctor)`, explicit `flush()`.
- Mutations are queued until the next flush point; queries iterating during a system see the world as it was at the start of the stage.
- Flush at the end of every Main stage, Fixed stage, and state-transition schedule.
- Within a flush, operations apply in enqueue order. Across systems in a stage, registration order determines flush sequence — this is documented.
- Tests cover: spawning during query iteration doesn't break the iterator; despawn during iteration deferred to flush; multiple commands across multiple systems within a stage flush in deterministic order; explicit `cmd.flush()` mid-stage makes the mutation visible to the same system's subsequent ops.
- No mention of parallel execution, thread-safety, or shared-memory primitives anywhere.

## Links

- Roadmap: `docs/roadmap/engine-foundations.md` (M2 umbrella, phase 6)
- Prereqs: `docs/backlog/system-param-protocol.md`, `docs/backlog/engine-resource-registry.md`, `docs/backlog/ecs-archetype-world.md`, `docs/backlog/engine-schedule-and-states.md`
- Consumers: `docs/backlog/transform-hierarchy.md` (spawn helpers like `withChildren` are sugar over Commands), `docs/backlog/engine-plugin-lifecycle.md`
- Future direction: `docs/roadmap/observers-and-events.md` (the deterministic flush guarantee is what makes observer/hook ordering predictable)
- External: Bevy `Commands` ([bevy-cheatbook](https://bevy-cheatbook.github.io/programming/commands.html)), command queue flushing semantics ([Bevy 0.15 → 0.16 migration](https://bevy.org/learn/migration-guides/0-15-to-0-16/))
