# Physics System

- **Created:** 2026-07-06
- **Status:** In progress (Phase 1 shipped 2026-07-06)
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

### Phase 2 — physics-rapier (2D) + real stepping

- `packages/physics-rapier` over `@dimforge/rapier2d-compat`; entity↔body maps;
  async wasm init gate (`ready()`); implement upsert/step/readBody. Sync gravity.
- Playground/studio demo: boxes fall under gravity and land on a static floor.

### Phase 3 — 3D + character controller + queries + events

- `rapier3d-compat`; `AngularVelocity3d` (Vec3); joints (fixed/revolute/etc.);
  Rapier kinematic character controller; raycast/shapecast query service;
  collision start/end events surfaced to ECS; a 3D demo + a moving character.

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
