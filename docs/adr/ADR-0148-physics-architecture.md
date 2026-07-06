# ADR-0148: Physics architecture (core contract + injected backend)

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

The engine has no physics. Shipping a complete game needs 2D and 3D rigid-body
dynamics — bodies that fall, collide, and can be moved as a character —
authored as ECS components and stepped deterministically. Constraints and prior
art:

- **Avian** (Bevy's ECS physics engine) is the component model to mirror:
  `RigidBody` (a body-type enum), `Collider` (a shape), `LinearVelocity` /
  `AngularVelocity`, `ExternalForce`, material components `Friction` /
  `Restitution`, `GravityScale`, and `Sensor`. Behaviour is data on components,
  read/written by systems.
- **Rapier** (`@dimforge/rapier2d-compat` / `rapier3d-compat`) is the intended
  backend: a mature, wasm, deterministic solver with separate 2D and 3D builds.
  The wasm is heavy and async-initialized.
- **The engine already has a fixed timestep** (`fixed*` sub-stages, ADR-owned
  `runFixedMainLoop`) — physics must step there, not per render frame.
- **Determinism / decoupling** — game code should author physics components with
  no Rapier knowledge, and the wasm backend should be swappable/absent (headless
  tests, or a future native backend).
- **Reflection** — authored physics components must round-trip in a scene (§13).

## Decision

Physics is split into a **core contract package and an injected backend**,
2D and 3D unified under `2d`/`3d`-suffixed components:

- **`packages/physics-core`** — the physics contract + data + engine
  integration. Holds: the `PhysicsBackend` interface and `PhysicsCapabilities`
  struct; the **Avian-shaped components** (`RigidBody2d`/`3d`, `Collider2d`/`3d`,
  `LinearVelocity2d`/`3d`, `AngularVelocity2d`/`3d`, `ExternalForce2d`/`3d`, and
  the dimension-agnostic material components `Restitution` / `Friction` /
  `GravityScale` / `Sensor`), all reflection-registered by its `PhysicsPlugin`;
  collision-event and raycast/query types; a `Gravity` resource; a
  `NullPhysicsBackend`; and the `PhysicsPlugin` that runs the **Sync → Step →
  Writeback** bridge inside the fixed timestep. It **does not** depend on any
  backend — that is the sense in which it is a "leaf" (`physics-rapier` depends on
  it, never the reverse). It depends on `engine` (for the plugin/bridge), `ecs`
  (`Entity`), `math`, and `reflect`. This intentionally differs from
  `renderer-core` (a pure HAL that `engine` depends on): `engine` does **not**
  depend on `physics-core`; games/studio add `PhysicsPlugin` and inject a backend.
- **`packages/physics-rapier`** — the concrete `PhysicsBackend` over
  `@dimforge/rapier2d-compat` + `rapier3d-compat`, with entity↔body maps.
  Depends on `physics-core` + rapier. The backend is **injected at App startup**
  (`new PhysicsPlugin({ backend: createRapierBackend() })`), so a project that
  only needs the component types — or a custom backend — never pulls the wasm.
- **The bridge** (in `PhysicsPlugin`, fixed timestep): **Sync** reads
  RigidBody/Collider/velocity/material components into a plain `BodySnapshot` and
  `upsertBody`s each into the backend (removals via `RemovedComponents` →
  `removeBody`); **Step** calls `backend.step(fixedDelta)`; **Writeback** reads
  each body's simulated transform/velocity back onto `Transform` /
  `LinearVelocity` / `AngularVelocity`. The `PhysicsBackend` interface speaks in
  `Entity` + plain snapshot structs, never ECS query types, so a backend stays
  ECS-agnostic.
- **Capabilities** (`PhysicsCapabilities`) flags optional backend features
  (dimensions supported, CCD, joints, character controller, shapecast) so engine
  code degrades gracefully — the same day-1 discipline as `RendererCapabilities`.

**Phasing.** This ADR's **Phase 1** ships `physics-core` only: the contract,
components + reflection, `Gravity`, `NullPhysicsBackend`, and the `PhysicsPlugin`
bridge skeleton (fully wired, but a no-op until a real backend is injected —
nothing moves). **Phase 2** is `physics-rapier` (2D) with real stepping and a
falling-body demo. **Phase 3** adds 3D, a character controller, joints, and
collision events / raycasts wired to the backend, plus a demo.

## Consequences

- Game code authors physics as reflection-round-tripping components with no
  Rapier knowledge; the backend is swappable and fully absent in headless tests
  (the null backend), so `physics-core` is unit-testable without wasm.
- Stepping in the fixed timestep gives frame-rate-independent, more
  deterministic simulation.
- The `Entity`+snapshot backend interface keeps Rapier's API contained in
  `physics-rapier`; the same bridge drives any conforming backend.
- The `2d`/`3d` suffix duplicates component types but keeps each dimension's math
  (`Vec2` vs `Vec3`, scalar vs `Vec3` angular velocity) exact and unambiguous —
  the Avian convention.
- `physics-core` depending on `engine` (unlike `renderer-core`) is a deliberate
  divergence: physics is an opt-in layer, not a thing `engine` is built on, so
  the dependency points the other way and no cycle exists.
- The Phase-1 bridge does real work only once a backend is injected; shipping it
  first lets Phase 2 be "drop in the Rapier backend" with the ECS integration
  already proven.

## Implementation

- `packages/physics-core/src/capabilities.ts` — `PhysicsCapabilities`, `PhysicsDimension`.
- `packages/physics-core/src/components-2d.ts`, `components-3d.ts`, `material.ts` — components.
- `packages/physics-core/src/backend.ts` — `PhysicsBackend`, `BodySnapshot`, `BodyReadback`,
  `CollisionEvent`, `RaycastQuery`/`RaycastHit`.
- `packages/physics-core/src/null-backend.ts` — `NullPhysicsBackend`.
- `packages/physics-core/src/gravity.ts` — `Gravity`.
- `packages/physics-core/src/bridge.ts` — `buildBodySnapshot`, sync/writeback helpers.
- `packages/physics-core/src/physics-plugin.ts` — `PhysicsPlugin`.
- `packages/physics-rapier/*` — _(none yet; Phase 2)_.
