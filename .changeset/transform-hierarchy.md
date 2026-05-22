---
'@retro-engine/engine': minor
'@retro-engine/ecs': minor
---

feat(engine): Transform + Hierarchy with propagation (M2 phase 7)

Adds the engine's core spatial primitives:

- `Transform` — single component carrying `translation: Vec3`, `rotation: Quat`, `scale: Vec3`. Required Components auto-attaches a `GlobalTransform`.
- `GlobalTransform` — world-space `Mat4` written each `'postUpdate'` by the engine's propagation system. Auto-registered in the `App` constructor (mirroring the `Time` tick auto-registration).
- `Parent` / `Children` — hierarchy edges; the propagation system reads `Parent` only, `Children` is maintained for ergonomic queries.
- `EntityCommands.withChildren((parent) => parent.spawn(...))`, `.addChild(child)`, `.removeChild(child)`, `.despawnRecursive()` — hierarchy-building sugar on the `Commands` API.
- `CommandsHandle.spawn(...)` now returns `EntityCommands` (was `Entity`); the entity id remains accessible via `.id`. Required so `cmd.spawn(...).withChildren(...)` chains naturally.

Propagation is depth-sorted by parent walk, single-threaded, recomputed every `PostUpdate`. Orphan children (`Parent.entity` is dead) and `Parent`-chain cycles are handled gracefully via `Logger.devWarn` — no crashes, no silent corruption.

In `@retro-engine/ecs`: adds `Query.entries()` yielding `[Entity, ...row]`, the entity-id-bearing variant of the standard query iterator. Used by the propagation system; available to any consumer needing entity ids alongside component data.

Sealed in ADR-0010.
