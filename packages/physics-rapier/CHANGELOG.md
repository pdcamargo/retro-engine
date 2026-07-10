# @retro-engine/physics-rapier

## 0.1.0

### Minor Changes

- 1214650: feat(physics): kinematic character controller (2D + 3D)

  Per ADR-0148, collide-and-slide character movement over Rapier's `KinematicCharacterController`.

  **New public surface (`physics-core`):**

  - `CharacterController2d` / `CharacterController3d` components (reflection-registered): authored config (`offset`, `up`, `maxSlopeClimbAngle`, `minSlopeSlideAngle`, `autostepHeight`/`autostepMinWidth`, `snapToGroundDistance`), a per-frame input `desiredTranslation`, and an output `grounded` (the last two are runtime, not serialized).
  - `CharacterConfig` / `CharacterMovement` types and `PhysicsBackend.moveCharacter(entity, config, desired)`.

  Attach a `CharacterController` alongside a kinematic `RigidBody` + `Collider`, set `desiredTranslation` each frame, and the physics bridge moves the character by the collision-corrected amount (after sync, before the step) and writes back `grounded`. The Rapier backend manages a per-entity `KinematicCharacterController` (autostep / snap-to-ground / slope limits applied per move) for both 2D and 3D; `capabilities.characterController` is now `true`.

  Verified headless: a kinematic character walks along a floor and stays grounded, and is stopped by a wall (collide-and-slide). Joints are the last remaining Physics P0 piece.

- 215a4d1: feat(physics): joints — completes the physics core

  Per ADR-0148, constraints between bodies over Rapier's `ImpulseJoint`, the last piece of the P0 physics surface.

  **New public surface (`physics-core`):**

  - `Joint2d` (`fixed` / `revolute` / `prismatic`) and `Joint3d` (`+ spherical`) components: a `target` entity (the other body), local anchors on each body, and a sliding/rotation `axis`. Reflection-registered (entity ref serialized via `t.entity()`).
  - `JointDesc` type; `PhysicsBackend.upsertJoint(owner, desc)` / `removeJoint(owner)`.

  Attach a `Joint2d`/`Joint3d` to one body referencing another; the bridge creates the joint once both bodies exist and removes it when the component is removed (or when either body despawns — Rapier auto-drops joints on a removed body). The Rapier backend builds the matching `JointData` for 2D and 3D; `capabilities.joints` is now `true`.

  Verified headless: a fixed joint holds a dynamic body against gravity, and removing the joint lets it fall. The playground `?mode=physics` demo now also includes an input-driven character (kinematic body + character controller) walking among the falling boxes — so the P0 "bodies fall, collide, and a character controller moves" demo is complete.

- 322f5f5: feat(physics): 3D Rapier backend — `createRapierBackend` now handles 2D **and** 3D

  The Rapier backend is now dimension-aware. Internally split into `world-2d.ts` (over `@dimforge/rapier2d-compat`) and `world-3d.ts` (over `@dimforge/rapier3d-compat`); `RapierBackend` routes each snapshot/query to the world for its `dimension`, and the two worlds simulate independently (an entity lives in exactly one). 3D uses Vec3 translation, quaternion rotation, Vec3 angular velocity, and `cuboid(hx, hy, hz)` / `ball` / `capsule` colliders. `capabilities.dimensions3d` is now `true`.

  Verified by deterministic headless tests: a 3D box falls under gravity and lands on a static floor (translation is a 3-tuple, rotation a quaternion), and a mixed scene runs 2D and 3D bodies independently in one backend. No public API change — `createRapierBackend()` is unchanged; it just does more. A kinematic character controller, joints, and ECS-surfaced collision events remain (Phase 3 continues).

- 97d1aa8: feat(physics): Phase 2 — Rapier 2D backend (`@retro-engine/physics-rapier`)

  Per ADR-0148, the concrete physics backend over `@dimforge/rapier2d-compat`. Inject it into `PhysicsPlugin` to get real 2D rigid-body dynamics:

  ```ts
  import { PhysicsPlugin } from "@retro-engine/physics-core";
  import { createRapierBackend } from "@retro-engine/physics-rapier";
  app.addPlugin(new PhysicsPlugin({ backend: createRapierBackend() }));
  ```

  **What it does:** implements the full `PhysicsBackend` contract for 2D — async wasm `init()`/`ready()` gate, entity↔body maps, `upsertBody` (dynamic/kinematic/static bodies with ball/cuboid/capsule colliders, restitution/friction/sensor), per-frame gravity, gravity-scale, external force, and kinematic targets, `step` at the fixed-timestep dt, `readBody` writeback, `removeBody`, `raycast`, and collision start/stop event drain. 3D snapshots are ignored (3D via `rapier3d-compat` is Phase 3).

  Verified by a **deterministic headless test** (a dynamic box falls under gravity and lands on a static floor; gravityScale 0 floats; removeBody drops the body). Playground `?mode=physics` demos boxes falling and stacking, with Space to drop more. A kinematic character controller, joints, 3D, and ECS-surfaced collision events are Phase 3.

### Patch Changes

- 57b89b9: feat(physics): surface collision start/stop events to ECS

  `CollisionEvent` is now a class (was an interface) so it doubles as an ECS message type. `PhysicsPlugin` registers it and, each fixed step, writes the backend's drained collision events to the channel — read them with `MessageReader(CollisionEvent)`:

  ```ts
  app.addSystem("update", [MessageReader(CollisionEvent)], (events) => {
    for (const e of events) if (e.kind === "started") onHit(e.a, e.b);
  });
  ```

  The Rapier backend now creates colliders with `ActiveEvents.COLLISION_EVENTS` so contacts actually report (Rapier is silent otherwise). Verified headless: a falling box lands on the floor and a `started` event is emitted between the two entities. Backends may return plain `{ kind, a, b }` objects — structurally assignable to the `CollisionEvent` class.

- Updated dependencies [6e1d04c]
- Updated dependencies [5ea3e80]
- Updated dependencies [2f22822]
- Updated dependencies [62e382e]
- Updated dependencies [1280e03]
- Updated dependencies [ac35dac]
- Updated dependencies [1214650]
- Updated dependencies [57b89b9]
- Updated dependencies [ecff40f]
- Updated dependencies [215a4d1]
- Updated dependencies [056bfc9]
- Updated dependencies [5c33631]
- Updated dependencies [8934a75]
- Updated dependencies [2beee52]
  - @retro-engine/ecs@0.1.0
  - @retro-engine/physics-core@0.1.0
