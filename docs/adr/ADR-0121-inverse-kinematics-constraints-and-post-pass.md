# ADR-0121: Inverse kinematics — constraints, solvers, and the post-pass

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

Phase 4 of the skeletal-animation initiative adds inverse kinematics: correcting
the posed skeleton so a foot plants, a hand reaches a target, or a head aims, on
top of whatever the animation/layer stack (ADR-0116 … ADR-0120) produced. The
prior phases established the pipeline IK must slot into: clips/controllers/layers
sample into a transient `Pose`, blend, and **commit once** to bone `Transform`s in
the `update` stage (ADR-0118); `postUpdate` then propagates `GlobalTransform`s
(gated, dirty-tracked — `propagateTransformsGated`) and computes the skinning
palette after propagation (ADR-0114/0115). IK is downstream of all of that — it
corrects the *committed* pose, it does not re-enter the pose blend.

Three load-bearing unknowns were researched rather than assumed (CLAUDE.md §2):

- **Two-bone analytic** (orangeduck "Simple Two Joint IK", RyanJuckett, ozz):
  law of cosines for the interior angles; clamp the target distance into the
  triangle-solvable range for reach; a pole/hint disambiguates the bend plane.
- **CCD vs FABRIK** (Aristidou FABRIK paper; Ghorbani survey): FABRIK converges
  in fewer iterations with smoother poses but works in **position space** and
  needs a reconstruction pass back to bone *rotations*; CCD works **directly on
  joint rotations**, the natural fit for a rotation hierarchy, and takes joint
  limits naturally.
- **Look-at / aim** (Unreal Control Rig Aim, Unity MultiAim): point a bone's
  configurable local aim axis at the target; a secondary up axis + world-up
  reference fixes the twist.

Industry constraint surfaces (Unity Animation Rigging `TwoBoneIKConstraint` /
`MultiAimConstraint`, Unreal IK chains, `bevy_mod_inverse_kinematics`) agree on
the data model: target and pole are **scene objects** (so they can be parented
and animated), and a **0–1 weight** blends the constraint against the source
(FK) pose.

## Decision

**Schedule ordering — one `postUpdate` system between propagation and skinning.**
The IK solve registers in `postUpdate` with
`{ after: ['transform-propagation'], before: ['skinning-compute-palettes'] }`.
Per frame: sample → blend → commit local TRS (`update`) → `transform-propagation`
computes all world transforms → **`ik-solve`** reads the now-valid world
transforms, solves, writes corrected **local** rotations, and **re-propagates only
each affected chain in place** → `skinning-compute-palettes` reads the corrected
joint world transforms. Re-propagation is targeted because the frame's gated
propagation has already run and will not run again: a new helper
`recomputeWorldSubtree(world, chainRoot)` walks `Children` from the chain root
(whose parent is untouched and already valid), recomposes
`global = parentGlobal × localMatrix` parent-before-child, and
`markChanged(GlobalTransform)` so the palette and any dirty-filtered consumer see
the new values. This is the delicate part; it is explicit so it cannot rot.

**Solver set — two-bone analytic + CCD + look-at/aim.** Three constraint
components, each a pure-math solver with no ECS access:

- `TwoBoneIK` — analytic law-of-cosines solver for a direct root → mid → tip
  limb (arms, legs, foot/hand IK), with a pole hint and reach clamping.
- `IkChain` — **CCD** over an ordered, direct joint chain for N-bone reaches
  (spine, tail). CCD over FABRIK because the skeleton is a rotation hierarchy:
  CCD outputs joint rotations directly (1:1 with `Transform.rotation`), where
  FABRIK would need a position→rotation reconstruction pass. FABRIK is recorded
  as a future alternate backend.
- `LookAtConstraint` — aim a bone's local aim axis at the target with an up/
  world-up twist reference (heads, eyes, turrets).

These three are the core primitives foot/hand IK, head aim, and Phase-5 contact
pinning need. The broader IK/constraint space (FABRIK, Full-Body IK, Spline IK,
per-joint limits, foot grounding, and the procedural rig-constraint family —
Multi-Parent/Position/Rotation/Referential, Blend, Override Transform, Damped
Transform, Twist Chain/Correction) is tracked, not built. Per-joint angle limits
and FABRIK are designed-for deferrals: the chain data leaves room for them.

**Target & pole are entity references; weight blends IK over FK.** `target` and
`pole` are nullable **entity** references (parentable, animatable; a pure
world-space target is a parked entity; a `null` pole keeps the current FK bend
plane). Each constraint carries `weight` (0..1): the solver produces the full IK
local rotation and the system writes `slerp(fkLocal, ikLocal, weight)` per
affected bone, so sweeping weight 0→1 blends IK in over the pose. `TwoBoneIK`
adds `targetRotationWeight` (the tip adopts the target's orientation — a planted
foot/hand). Constraints reference bones by **entity** (the `Skeleton` already
holds joint entities), independent of the `AnimationTarget` string ids clips bind
through. Multiple constraints on one rig solve in ascending `order`, each
re-propagating before the next reads world transforms.

**The FK-pose invariant.** IK blends over the bone's **current local rotation at
solve time**, which is the FK pose the animation/pose commit re-establishes every
frame. A bone with no animation driving it does not get its FK re-established, so
its weight blend drifts toward full IK over frames; such bones should be driven
at `weight = 1` or be animated. This matches how a Unity-style animation stream
re-evaluates the source pose each frame, and is the honest boundary of the
read-current-local approach (no separate FK snapshot resource this phase).

**Reflection (CLAUDE.md §13).** `TwoBoneIK`, `IkChain`, and `LookAtConstraint`
are authored components with schemas registered by `IkPlugin` — entity references
via `t.entity().nullable()`, weights with `meta({ range: [0,1] })` — so they
round-trip through scenes and survive hot reload (ADR-0102). No transient runtime
resource: the solve reads world transforms and writes locals in place, holding
only reusable scratch.

## Consequences

- IK corrects the committed FK pose with no GPU change: it is transform math
  inserted between propagation and the palette. Phase 0's render path is
  untouched.
- Targeted re-propagation keeps the cost proportional to the affected chains, not
  the whole hierarchy, and avoids a second full gated pass.
- The entity-reference target + per-constraint weight are exactly the seam Phase 5
  (retargeting) reuses: a retargeter parks a foot/hand target at the source
  contact each frame and the IK constraint pins it while proportions differ.
- CCD's solve is O(iterations × bones²) per chain (bones small); FABRIK would be
  O(bones) per iteration but commits the engine to a reconstruction pass — the
  trade-off is recorded, FABRIK deferred.
- The single-transition FK invariant (read current local) is a deliberate
  simplification; a dedicated FK-snapshot resource is the documented upgrade path
  if non-animated weighted IK becomes a need.
- Multiple constraints are ordered by an explicit `order` field, not query
  iteration order, so layered foot + look-at + chain solves are deterministic.

## Implementation

- `packages/engine/src/animation/ik/two-bone.ts` — `solveTwoBone`,
  `TwoBoneSolveInput`, `TwoBoneSolveOutput`.
- `packages/engine/src/animation/ik/ccd.ts` — `solveCcd`, `CcdSolveInput`.
- `packages/engine/src/animation/ik/look-at.ts` — `solveAim`, `AimSolveInput`.
- `packages/engine/src/animation/ik/ik-constraints.ts` — `TwoBoneIK`, `IkChain`,
  `LookAtConstraint`.
- `packages/engine/src/animation/ik/ik-system.ts` — `addIkSolve` (the
  `postUpdate` solve: read world transforms, solve, weighted local write,
  per-chain re-propagation).
- `packages/engine/src/animation/ik/ik-plugin.ts` — `IkPlugin` (schemas + system).
- `packages/engine/src/hierarchy.ts` — `recomputeWorldSubtree`.
- `packages/engine/src/core-plugin.ts` — `CorePlugin` adds `IkPlugin` after
  `AnimationPlugin`.
- `packages/engine/src/animation/ik/index.ts`, `packages/engine/src/animation/index.ts`,
  `packages/engine/src/index.ts` — public re-exports.
- `packages/engine/bench/ik-solve.bench.ts` — solver hot path (two-bone, look-at,
  CCD across bones × iterations).
