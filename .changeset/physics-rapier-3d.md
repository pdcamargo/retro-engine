---
'@retro-engine/physics-rapier': minor
---

feat(physics): 3D Rapier backend — `createRapierBackend` now handles 2D **and** 3D

The Rapier backend is now dimension-aware. Internally split into `world-2d.ts` (over `@dimforge/rapier2d-compat`) and `world-3d.ts` (over `@dimforge/rapier3d-compat`); `RapierBackend` routes each snapshot/query to the world for its `dimension`, and the two worlds simulate independently (an entity lives in exactly one). 3D uses Vec3 translation, quaternion rotation, Vec3 angular velocity, and `cuboid(hx, hy, hz)` / `ball` / `capsule` colliders. `capabilities.dimensions3d` is now `true`.

Verified by deterministic headless tests: a 3D box falls under gravity and lands on a static floor (translation is a 3-tuple, rotation a quaternion), and a mixed scene runs 2D and 3D bodies independently in one backend. No public API change — `createRapierBackend()` is unchanged; it just does more. A kinematic character controller, joints, and ECS-surfaced collision events remain (Phase 3 continues).
