---
'@retro-engine/physics-core': minor
'@retro-engine/physics-rapier': minor
---

feat(physics): joints — completes the physics core

Per ADR-0148, constraints between bodies over Rapier's `ImpulseJoint`, the last piece of the P0 physics surface.

**New public surface (`physics-core`):**

- `Joint2d` (`fixed` / `revolute` / `prismatic`) and `Joint3d` (`+ spherical`) components: a `target` entity (the other body), local anchors on each body, and a sliding/rotation `axis`. Reflection-registered (entity ref serialized via `t.entity()`).
- `JointDesc` type; `PhysicsBackend.upsertJoint(owner, desc)` / `removeJoint(owner)`.

Attach a `Joint2d`/`Joint3d` to one body referencing another; the bridge creates the joint once both bodies exist and removes it when the component is removed (or when either body despawns — Rapier auto-drops joints on a removed body). The Rapier backend builds the matching `JointData` for 2D and 3D; `capabilities.joints` is now `true`.

Verified headless: a fixed joint holds a dynamic body against gravity, and removing the joint lets it fall. The playground `?mode=physics` demo now also includes an input-driven character (kinematic body + character controller) walking among the falling boxes — so the P0 "bodies fall, collide, and a character controller moves" demo is complete.
