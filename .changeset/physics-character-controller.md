---
'@retro-engine/physics-core': minor
'@retro-engine/physics-rapier': minor
---

feat(physics): kinematic character controller (2D + 3D)

Per ADR-0148, collide-and-slide character movement over Rapier's `KinematicCharacterController`.

**New public surface (`physics-core`):**

- `CharacterController2d` / `CharacterController3d` components (reflection-registered): authored config (`offset`, `up`, `maxSlopeClimbAngle`, `minSlopeSlideAngle`, `autostepHeight`/`autostepMinWidth`, `snapToGroundDistance`), a per-frame input `desiredTranslation`, and an output `grounded` (the last two are runtime, not serialized).
- `CharacterConfig` / `CharacterMovement` types and `PhysicsBackend.moveCharacter(entity, config, desired)`.

Attach a `CharacterController` alongside a kinematic `RigidBody` + `Collider`, set `desiredTranslation` each frame, and the physics bridge moves the character by the collision-corrected amount (after sync, before the step) and writes back `grounded`. The Rapier backend manages a per-entity `KinematicCharacterController` (autostep / snap-to-ground / slope limits applied per move) for both 2D and 3D; `capabilities.characterController` is now `true`.

Verified headless: a kinematic character walks along a floor and stays grounded, and is stopped by a wall (collide-and-slide). Joints are the last remaining Physics P0 piece.
