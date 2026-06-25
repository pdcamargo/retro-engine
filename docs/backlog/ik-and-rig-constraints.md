# IK & rig constraints — the broader space beyond Phase 4

Phase 4 of the skeletal-animation initiative ([ADR-0121](../adr/ADR-0121-inverse-kinematics-constraints-and-post-pass.md))
shipped the three **core IK primitives**: two-bone analytic IK (`TwoBoneIK`), an
N-bone CCD chain (`IkChain`), and a look-at/aim constraint (`LookAtConstraint`),
all solving in a `postUpdate` post-pass after transform propagation and before
the skinning palette. These cover foot/hand IK, head aim, and the contact-pinning
Phase 5 (retargeting) reuses.

This file tracks the rest of the IK/constraint space — researched and deliberately
deferred, not forgotten. Promote items to their own backlog entry + ADR when one
is picked up.

## Iterative-solver backends

- **FABRIK** as an alternate to CCD for `IkChain`. Converges in fewer iterations
  with smoother poses, but works in position space and needs a position→rotation
  reconstruction pass (ADR-0121 chose CCD because the skeleton is a rotation
  hierarchy). Worth adding when chain quality/perf demands it; the chain data
  model already fits.
- **Per-joint angle limits** (hinge / cone / twist) for CCD and FABRIK. The
  quality multiplier that stops a knee/elbow folding backward and keeps long
  chains from unrolling. ADR-0121 left the chain data designed for a parallel
  limits array.

## Higher-level solvers

- **Full-Body IK (FBIK / PBIK / VRIK)** — solve the whole skeleton from a few
  effectors (drag a hand, the spine/hips react; 3-point VR → full body). A
  distinct solver, not a constraint; Unreal Control Rig and Final IK ship it.
- **Spline IK** — bones follow a spline (tails, tentacles, cabling, long spines).
- **Foot grounding / raycast IK** — auto-place feet on terrain via a raycast that
  positions the foot target, then a two-bone solve. A gameplay layer on top of
  the existing `TwoBoneIK`; needs scene-query/raycast plumbing.

## Procedural rig-constraint family (Unity Animation Rigging's non-IK set)

Transform constraints that live in the same "rigging" surface but are not IK
solvers. Each maps to a small component + a `postUpdate` pass alongside `ik-solve`:

- **Multi-Parent / Multi-Position / Multi-Rotation / Multi-Referential** — drive a
  bone from a weighted blend of several source transforms.
- **Blend Constraint** — blend a bone between two sources by weight.
- **Override Transform** — additively override a bone's transform from an external
  one.
- **Damped Transform** — springy/lagged follow for secondary motion (antennae,
  cloth-ish jiggle without a sim).
- **Twist Chain / Twist Correction** — distribute roll along forearm/upper-arm/
  thigh twist bones so skinning does not pinch.

## Editor tooling (separate from runtime)

- A studio **IK-authoring panel** (pick root/mid/tip/target/pole from the bone
  tree; weight sliders; gizmos for target/pole). Runtime constraints drive via
  code/MCP today (same posture ADR-0119/ADR-0120 took for controllers/masks).

## Notes for whoever picks this up

- The FK-pose invariant (ADR-0121): IK blends over the per-frame FK pose, which the
  animation/pose commit re-establishes. A dedicated FK-snapshot resource is the
  upgrade path if weighted IK on non-animated bones becomes a need.
- Re-propagation: `recomputeWorldSubtree(world, chainRoot)` in `hierarchy.ts` is
  the targeted-chain refresh any new constraint should reuse after writing locals.
