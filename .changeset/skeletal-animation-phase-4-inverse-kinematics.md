---
'@retro-engine/engine': minor
---

feat(engine): skeletal-animation Phase 4 — inverse kinematics

Per ADR-0121, IK constraints correct the posed skeleton as a post-pass — a foot plants, a hand
reaches a target, a head aims — on top of whatever the animation/layer stack produced. Pure
transform math: no new GPU work beyond Phase 0. The IK solve runs in `postUpdate`
`{ after: ['transform-propagation'], before: ['skinning-compute-palettes'] }`, so it reads valid
world transforms and the corrected pose reaches the skinning palette the same frame.

**Solvers** (`animation/ik/two-bone.ts`, `ccd.ts`, `look-at.ts`) — pure, ECS-free:

- `solveTwoBone` — analytic law-of-cosines limb solver (shoulder/elbow/hand, hip/knee/ankle) with a
  pole hint for the bend plane and reach clamping into the triangle-solvable range.
- `solveCcd` — Cyclic Coordinate Descent for N-bone chains (spine, tail). CCD over FABRIK because the
  skeleton is a rotation hierarchy — CCD outputs joint rotations directly; FABRIK is backlogged.
- `solveAim` — look-at/aim: point a bone's local aim axis at the target, roll about it so an up axis
  aligns with a world-up reference.

**Constraint components** (`animation/ik/ik-constraints.ts`) — `TwoBoneIK`, `IkChain`,
`LookAtConstraint`, each a reflected, schema-registered component (round-trips through scenes,
survives hot reload). Target and pole are nullable **entity** references (parentable/animatable; a
`null` pole keeps the FK bend). A per-constraint `weight` (0..1) blends the IK result over the FK
pose via slerp; `TwoBoneIK.targetRotationWeight` orients the tip to a planted foot/hand. Multiple
constraints on a rig solve in ascending `order`.

**System + re-propagation** (`animation/ik/ik-system.ts`, `hierarchy.ts`) — `addIkSolve` reads each
bone's world transform, solves, writes the weighted local rotation, and re-propagates just the
affected chain in place via the new `recomputeWorldSubtree(world, chainRoot)` helper (the frame's
gated propagation has already run and will not run again). `IkPlugin` registers the components and
the system; `CorePlugin` adds it after `AnimationPlugin`.

The entity-reference target + per-constraint weight are the contact-pinning seam Phase 5
(retargeting) reuses. The broader IK/constraint space (FABRIK backend, Full-Body IK, Spline IK,
per-joint limits, foot grounding, the procedural rig-constraint family) is backlogged. Adds an
`ik-solve` bench (two-bone, look-at, CCD across bones × iterations).
