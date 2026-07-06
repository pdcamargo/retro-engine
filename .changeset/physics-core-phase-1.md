---
'@retro-engine/physics-core': minor
---

feat(physics): Phase 1 — physics contract + Avian-shaped components (`@retro-engine/physics-core`)

Per ADR-0148, a backend-agnostic physics core layered on the engine. Game code authors physics as ECS components; a concrete solver (`@retro-engine/physics-rapier`, Phase 2) is injected at App startup.

**New public surface:**

- `PhysicsBackend` interface + `PhysicsCapabilities` (feature flags: dimensions, CCD, joints, character controller, raycast/shapecast) + `NullPhysicsBackend` (no-op headless default).
- Avian-shaped, `2d`/`3d`-suffixed components, all reflection-registered by `PhysicsPlugin`: `RigidBody2d`/`3d` (body type + `dynamic()`/`kinematic()`/`fixed()` factories), `Collider2d`/`3d` (shape + `circle`/`rectangle`/`capsule` · `sphere`/`cuboid`/`capsule` factories), `LinearVelocity2d`/`3d`, `AngularVelocity2d` (scalar) / `AngularVelocity3d` (Vec3), `ExternalForce2d`/`3d`, and dimension-agnostic `Restitution` / `Friction` / `GravityScale` / `Sensor`.
- `Gravity` resource (2D + 3D vectors); `Physics` resource (raycast + capabilities query facade).
- `PhysicsPlugin` — runs the Sync → Step → Writeback bridge in the fixed timestep against the injected backend (a no-op until a backend is present, so nothing moves yet).
- Bridge helpers (pure, benched): `snapshot2d`/`snapshot3d`, `colliderDesc2d`/`3d`, `angle2dFromQuat`, `applyReadback2d`/`3d`, plus `BodySnapshot` / `BodyReadback` / `CollisionEvent` / `RaycastQuery` / `RaycastHit` types.

The Rapier backend (2D then 3D), joints, a kinematic character controller, live collision events / raycasts, and a falling/character demo are Phase 2/3.
