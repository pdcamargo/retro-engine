# Physics System

- **Created:** 2026-07-06
- **Status:** In progress (Phases 1–2 + 3D backend shipped 2026-07-06)
- **ADR:** [ADR-0148](../adr/ADR-0148-physics-architecture.md)

## Goal

2D and 3D rigid-body physics, authored as ECS components (Avian-shaped,
`2d`/`3d`-suffixed) and stepped in the fixed timestep. A `physics-core` contract
package with an injected Rapier backend, so game code is backend-agnostic and the
wasm is opt-in.

## Phases

### Phase 1 — physics-core contract + components ✅ (2026-07-06)

- `PhysicsBackend` interface + `PhysicsCapabilities`; `NullPhysicsBackend`.
- Components (reflection-registered): `RigidBody2d`/`3d` (body type),
  `Collider2d`/`3d` (shape), `LinearVelocity2d`/`3d`, `AngularVelocity2d`/`3d`,
  `ExternalForce2d`/`3d`, `Restitution`, `Friction`, `GravityScale`, `Sensor`.
- `Gravity` resource; `PhysicsPlugin` with the Sync → Step → Writeback bridge in
  the fixed timestep (no-op until a backend is injected).
- Tests (reflection round-trip + bridge snapshot), a snapshot bench.

### Phase 2 — physics-rapier (2D) + real stepping ✅ (2026-07-06)

- `@retro-engine/physics-rapier` (`createRapierBackend`) over `@dimforge/rapier2d-compat`;
  entity↔body maps; async wasm init gate (`ready()`); upsert/step/readBody/removeBody,
  setGravity, gravity-scale, external force, kinematic targets, raycast, collision-event
  drain. Verified headless (deterministic bun test: a box falls and lands on the floor).
- Playground `?mode=physics`: boxes fall + stack on a static floor; Space drops more.

### Phase 3 — 3D + character controller + queries + events

- **3D backend ✅ (2026-07-06):** the Rapier backend now handles both dims —
  `world-2d.ts` / `world-3d.ts` adapters over `rapier2d-compat` / `rapier3d-compat`,
  routed by `snapshot.dimension`; 3D uses Vec3 translation, quaternion rotation,
  Vec3 angular velocity, `cuboid(hx,hy,hz)`. Verified headless (a 3D box falls +
  lands; 2D and 3D simulate independently in one backend). `capabilities.dimensions3d`.
- **Collision events ✅ (2026-07-06):** `CollisionEvent` is an ECS message;
  `PhysicsPlugin` writes the backend's drained start/stop events each fixed step
  (colliders created with `ActiveEvents.COLLISION_EVENTS`). Read via
  `MessageReader(CollisionEvent)`. Verified headless (box lands → `started` event).
- **Character controller ✅ (2026-07-06):** `CharacterController2d`/`3d` components
  (offset, slope limits, autostep, snap-to-ground, `desiredTranslation` in /
  `grounded` out) over Rapier's `KinematicCharacterController` (per-entity, 2D+3D).
  Verified headless (character walks a floor + stays grounded; blocked by a wall).
- **Remaining:** joints (fixed/revolute/…); a playground/studio demo with a moving
  character (2D `?mode=physics` demo exists for falling bodies).

### Phase 4 — Studio integration (P1/P2)

- Collider gizmos, a physics debug-draw toggle, inspector for physics components.

## Open questions (resolved / remaining)

- **Package split?** → `physics-core` (contract + components + plugin, engine-
  facing) + `physics-rapier` (injected backend). `engine` does not depend on
  either (ADR-0148).
- **2D vs 3D unification?** → separate `2d`/`3d` components (Avian convention);
  material components (`Friction`/`Restitution`/`GravityScale`/`Sensor`) are shared.
- **Where does it step?** → the fixed timestep, via the `PhysicsPlugin` bridge.
- **Determinism / wasm init** → backend `init()`/`ready()` gate; the bridge skips
  stepping until the backend reports ready (Phase 2).

## Links

- [ADR-0148](../adr/ADR-0148-physics-architecture.md)
- Avian (Bevy physics); Rapier (`@dimforge/rapier2d-compat`, `rapier3d-compat`)
