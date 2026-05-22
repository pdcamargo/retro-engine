---
'@retro-engine/engine': minor
'@retro-engine/ecs': minor
---

feat(engine): add `Commands` system param with per-system flush

`Commands` is a system param that records structural mutations
(`spawn` / `despawn` / `entity().insert` / `entity().remove` /
`insertResource` / `removeResource`) into a per-system buffer and applies
them at deterministic boundaries — immediately after each system's
function returns. `cmd.spawn` returns an `Entity` synchronously so
sibling commands in the same buffer can target it. `App.flushCommands()`
is the orchestration-side escape hatch.

Adds `World.reserveEntity()`, `World.spawnReserved()`, and
`World.hasEntity()` as low-level building blocks. Sealed in ADR-0009.
