# @retro-engine/physics-core

## 0.1.0

### Minor Changes

- 1214650: feat(physics): kinematic character controller (2D + 3D)

  Per ADR-0148, collide-and-slide character movement over Rapier's `KinematicCharacterController`.

  **New public surface (`physics-core`):**

  - `CharacterController2d` / `CharacterController3d` components (reflection-registered): authored config (`offset`, `up`, `maxSlopeClimbAngle`, `minSlopeSlideAngle`, `autostepHeight`/`autostepMinWidth`, `snapToGroundDistance`), a per-frame input `desiredTranslation`, and an output `grounded` (the last two are runtime, not serialized).
  - `CharacterConfig` / `CharacterMovement` types and `PhysicsBackend.moveCharacter(entity, config, desired)`.

  Attach a `CharacterController` alongside a kinematic `RigidBody` + `Collider`, set `desiredTranslation` each frame, and the physics bridge moves the character by the collision-corrected amount (after sync, before the step) and writes back `grounded`. The Rapier backend manages a per-entity `KinematicCharacterController` (autostep / snap-to-ground / slope limits applied per move) for both 2D and 3D; `capabilities.characterController` is now `true`.

  Verified headless: a kinematic character walks along a floor and stays grounded, and is stopped by a wall (collide-and-slide). Joints are the last remaining Physics P0 piece.

- 57b89b9: feat(physics): surface collision start/stop events to ECS

  `CollisionEvent` is now a class (was an interface) so it doubles as an ECS message type. `PhysicsPlugin` registers it and, each fixed step, writes the backend's drained collision events to the channel — read them with `MessageReader(CollisionEvent)`:

  ```ts
  app.addSystem("update", [MessageReader(CollisionEvent)], (events) => {
    for (const e of events) if (e.kind === "started") onHit(e.a, e.b);
  });
  ```

  The Rapier backend now creates colliders with `ActiveEvents.COLLISION_EVENTS` so contacts actually report (Rapier is silent otherwise). Verified headless: a falling box lands on the floor and a `started` event is emitted between the two entities. Backends may return plain `{ kind, a, b }` objects — structurally assignable to the `CollisionEvent` class.

- ecff40f: feat(physics): Phase 1 — physics contract + Avian-shaped components (`@retro-engine/physics-core`)

  Per ADR-0148, a backend-agnostic physics core layered on the engine. Game code authors physics as ECS components; a concrete solver (`@retro-engine/physics-rapier`, Phase 2) is injected at App startup.

  **New public surface:**

  - `PhysicsBackend` interface + `PhysicsCapabilities` (feature flags: dimensions, CCD, joints, character controller, raycast/shapecast) + `NullPhysicsBackend` (no-op headless default).
  - Avian-shaped, `2d`/`3d`-suffixed components, all reflection-registered by `PhysicsPlugin`: `RigidBody2d`/`3d` (body type + `dynamic()`/`kinematic()`/`fixed()` factories), `Collider2d`/`3d` (shape + `circle`/`rectangle`/`capsule` · `sphere`/`cuboid`/`capsule` factories), `LinearVelocity2d`/`3d`, `AngularVelocity2d` (scalar) / `AngularVelocity3d` (Vec3), `ExternalForce2d`/`3d`, and dimension-agnostic `Restitution` / `Friction` / `GravityScale` / `Sensor`.
  - `Gravity` resource (2D + 3D vectors); `Physics` resource (raycast + capabilities query facade).
  - `PhysicsPlugin` — runs the Sync → Step → Writeback bridge in the fixed timestep against the injected backend (a no-op until a backend is present, so nothing moves yet).
  - Bridge helpers (pure, benched): `snapshot2d`/`snapshot3d`, `colliderDesc2d`/`3d`, `angle2dFromQuat`, `applyReadback2d`/`3d`, plus `BodySnapshot` / `BodyReadback` / `CollisionEvent` / `RaycastQuery` / `RaycastHit` types.

  The Rapier backend (2D then 3D), joints, a kinematic character controller, live collision events / raycasts, and a falling/character demo are Phase 2/3.

- 215a4d1: feat(physics): joints — completes the physics core

  Per ADR-0148, constraints between bodies over Rapier's `ImpulseJoint`, the last piece of the P0 physics surface.

  **New public surface (`physics-core`):**

  - `Joint2d` (`fixed` / `revolute` / `prismatic`) and `Joint3d` (`+ spherical`) components: a `target` entity (the other body), local anchors on each body, and a sliding/rotation `axis`. Reflection-registered (entity ref serialized via `t.entity()`).
  - `JointDesc` type; `PhysicsBackend.upsertJoint(owner, desc)` / `removeJoint(owner)`.

  Attach a `Joint2d`/`Joint3d` to one body referencing another; the bridge creates the joint once both bodies exist and removes it when the component is removed (or when either body despawns — Rapier auto-drops joints on a removed body). The Rapier backend builds the matching `JointData` for 2D and 3D; `capabilities.joints` is now `true`.

  Verified headless: a fixed joint holds a dynamic body against gravity, and removing the joint lets it fall. The playground `?mode=physics` demo now also includes an input-driven character (kinematic body + character controller) walking among the falling boxes — so the P0 "bodies fall, collide, and a character controller moves" demo is complete.

- 056bfc9: feat: expose feature-component reflection registration independent of the plugins

  Each feature plugin now factors its component-schema registration into a standalone, exported function so a host (e.g. an editor's component palette) can register the component _types_ for authoring and serialization without installing the plugin's systems or render passes.

  New public surface:

  - `@retro-engine/physics-core`: `registerPhysicsComponents(app)` — all 2D/3D bodies, colliders, velocities, forces, materials, character controllers, and joints.
  - `@retro-engine/audio`: `registerAudioComponents(app)` — `AudioSource`, `AudioListener`.
  - `@retro-engine/input`: `registerInputComponents(app)` — `ActionBinding`/`ActionDef` value types + the `ActionMap` component.
  - `@retro-engine/ui`: `registerUiComponents(app)` — every UI component (layout, text, image, style class, button/toggle/slider/text-input, and the interaction/focus/diagnostics markers), plus the now-exported `uiButtonSchema` / `uiToggleSchema` / `uiSliderSchema` / `uiTextInputSchema`.
  - `@retro-engine/engine`: `registerSpriteComponents(app)`, `registerLight2dComponents(app)`, `registerTextComponents(app)` — the sprite (+ atlas), 2D light, and text component schemas.

  Each owning plugin's `build` now delegates to its function, so behavior is unchanged. Registering the same constructor twice is idempotent, so calling these alongside the full plugin is safe.

### Patch Changes

- Updated dependencies [45c51aa]
- Updated dependencies [1b9b7f5]
- Updated dependencies [7d40c1a]
- Updated dependencies [937f2cb]
- Updated dependencies [b315044]
- Updated dependencies [d5424c3]
- Updated dependencies [e0c4984]
- Updated dependencies [15617ff]
- Updated dependencies [ab6e7b9]
- Updated dependencies [1b66f35]
- Updated dependencies [0baa8a9]
- Updated dependencies [7142f6f]
- Updated dependencies [2c27d90]
- Updated dependencies [7e26e59]
- Updated dependencies [e73d32e]
- Updated dependencies [9c36012]
- Updated dependencies [12eb41d]
- Updated dependencies [773fabd]
- Updated dependencies [afc904c]
- Updated dependencies [3b3cf7f]
- Updated dependencies [2c27d90]
- Updated dependencies [a9837c6]
- Updated dependencies [f8079c6]
- Updated dependencies [e8c703e]
- Updated dependencies [2324f9f]
- Updated dependencies [294c161]
- Updated dependencies [597b913]
- Updated dependencies [6e1d04c]
- Updated dependencies [5ea3e80]
- Updated dependencies [2f22822]
- Updated dependencies [62e382e]
- Updated dependencies [5d7a21a]
- Updated dependencies [8d36fd7]
- Updated dependencies [3b04954]
- Updated dependencies [1280e03]
- Updated dependencies [fdde82f]
- Updated dependencies [9d41f83]
- Updated dependencies [056bfc9]
- Updated dependencies [1cdff13]
- Updated dependencies [1c76eef]
- Updated dependencies [d8b7fc2]
- Updated dependencies [5ea3e80]
- Updated dependencies [68963c6]
- Updated dependencies [be766a4]
- Updated dependencies [bc7640e]
- Updated dependencies [cad5613]
- Updated dependencies [4741039]
- Updated dependencies [4ca7beb]
- Updated dependencies [0bc6ca5]
- Updated dependencies [e163274]
- Updated dependencies [5317052]
- Updated dependencies [5599db7]
- Updated dependencies [5988cb6]
- Updated dependencies [a055d25]
- Updated dependencies [2a7a18b]
- Updated dependencies [da51d57]
- Updated dependencies [c2732c5]
- Updated dependencies [fad8a5e]
- Updated dependencies [1c4a0fe]
- Updated dependencies [c4bf47a]
- Updated dependencies [7812b83]
- Updated dependencies [8e4574a]
- Updated dependencies [be4aad1]
- Updated dependencies [88d0fc5]
- Updated dependencies [01070b1]
- Updated dependencies [b788a60]
- Updated dependencies [a3b6d83]
- Updated dependencies [43cae6c]
- Updated dependencies [90a56e2]
- Updated dependencies [88d3ca3]
- Updated dependencies [68ce298]
- Updated dependencies [b5e3322]
- Updated dependencies [10bda28]
- Updated dependencies [ca1cafa]
- Updated dependencies [e97fdd2]
- Updated dependencies [3db9d87]
- Updated dependencies [0c7b778]
- Updated dependencies [781aa88]
- Updated dependencies [7142f6f]
- Updated dependencies [eb3c452]
- Updated dependencies [e6728cc]
- Updated dependencies [8029403]
- Updated dependencies [d63d0f9]
- Updated dependencies [c049410]
- Updated dependencies [707714f]
- Updated dependencies [3658119]
- Updated dependencies [ac35dac]
- Updated dependencies [3280a8e]
- Updated dependencies [62effe1]
- Updated dependencies [ca677c6]
- Updated dependencies [abbd55c]
- Updated dependencies [67e8513]
- Updated dependencies [8ac39a9]
- Updated dependencies [92d6c91]
- Updated dependencies [f8079c6]
- Updated dependencies [75a1a8a]
- Updated dependencies [e6728cc]
- Updated dependencies [a896a3b]
- Updated dependencies [5be634a]
- Updated dependencies [690c811]
- Updated dependencies [da1f0eb]
- Updated dependencies [056bfc9]
- Updated dependencies [7dc7bca]
- Updated dependencies [5c33631]
- Updated dependencies [fa2678b]
- Updated dependencies [67e8513]
- Updated dependencies [836a7ab]
- Updated dependencies [ea56975]
- Updated dependencies [6fbb29d]
- Updated dependencies [d25c7aa]
- Updated dependencies [4015d71]
- Updated dependencies [82ecdec]
- Updated dependencies [bcef667]
- Updated dependencies [c26f7a3]
- Updated dependencies [7b8eeea]
- Updated dependencies [8a6fb8f]
- Updated dependencies [9712180]
- Updated dependencies [bc24cd2]
- Updated dependencies [f45c5f0]
- Updated dependencies [824b04f]
- Updated dependencies [47372a5]
- Updated dependencies [73fdef4]
- Updated dependencies [88c4629]
- Updated dependencies [93f4053]
- Updated dependencies [ba77627]
- Updated dependencies [f2f082b]
- Updated dependencies [641b263]
- Updated dependencies [7812b83]
- Updated dependencies [48686b4]
- Updated dependencies [f0584f2]
- Updated dependencies [bc634ae]
- Updated dependencies [f95bac1]
- Updated dependencies [7dddd6f]
- Updated dependencies [a0fb8d4]
- Updated dependencies [59d37c2]
- Updated dependencies [acae153]
- Updated dependencies [8934a75]
- Updated dependencies [f55bffb]
- Updated dependencies [b1a1e01]
- Updated dependencies [5b52805]
- Updated dependencies [dd3de07]
- Updated dependencies [d8c0bda]
- Updated dependencies [b10dc50]
- Updated dependencies [05d2bb6]
- Updated dependencies [0f8701d]
- Updated dependencies [7f40ed1]
- Updated dependencies [591fdef]
- Updated dependencies [42d7275]
- Updated dependencies [b2a610d]
- Updated dependencies [2beee52]
- Updated dependencies [5cf81f9]
- Updated dependencies [ce20898]
- Updated dependencies [823e5cd]
  - @retro-engine/engine@0.1.0
  - @retro-engine/reflect@0.1.0
  - @retro-engine/ecs@0.1.0
  - @retro-engine/math@0.1.0
