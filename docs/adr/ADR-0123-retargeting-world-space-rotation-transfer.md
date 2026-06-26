# ADR-0123: Retargeting — world-space rotation transfer for cross-orientation rigs

- **Status:** Superseded by ADR-0125
- **Date:** 2026-06-25

## Context

ADR-0122 shipped animation retargeting as a clip-production step (`retargetClip`)
over a `RetargetRig` rig description, with a **local-space** rest-relative
rotation transfer (`tgtLocal = tgtRest · srcRest⁻¹ · srcAnim`). It noted that the
local form is exact only for rigs that share a **bind orientation**, and recorded
the cross-orientation world-space generalization as "the documented extension if
a future rig pair needs it."

Verifying Phase 5 against a real workload exposed that this is not a rare future
case — it is the **normal** one. Two Synty animation GLBs (`A_Death_B_01_Sword`,
`A_Attack_HeavyFlourish01_Sword`), converted from FBX through Blender, were
retargeted onto the studio's `Character.glb` Biker. Although all three nominally
use the "same" Synty skeleton, their **bind poses differ**: bone local axes are
permuted (e.g. `UpperLeg_L`'s rest offset lies on a different axis), and the GLBs
have different node counts and orders. A downloaded animation pack almost always
carries its own bind convention. Under the local-space transfer the rotations
were applied in the wrong frame and the character's limbs flew to wrong
positions. The local form is therefore insufficient for the phase's actual goal
("take a GLB's animation and use it on another character").

The fix is the standard per-bind world-space transfer (three.js retargeting /
Unreal IK-Rig): re-base each bone's animated rotation through **both rigs' rest
world rotations**, which preserves the bone's world-space rotation *delta from
its own bind* across skeletons that rest in different orientations.

## Decision

**The shipped rotation transfer is world-space, refining ADR-0122's transfer
decision** (ADR-0122's other decisions — clip-production over a per-frame
component, the `RetargetRig` asset, IK contact pinning, humanoid body-part mask —
stand unchanged). For a bone filling a canonical slot:

```
tgtLocal = tgtParentRestWorld⁻¹ · srcParentRestWorld · srcLocalAnim · srcRestWorld⁻¹ · tgtRestWorld
```

The two outer products are constant per bone:
`A = tgtParentRestWorld⁻¹ · srcParentRestWorld`,
`B = srcRestWorld⁻¹ · tgtRestWorld`, so `tgtLocal = A · srcLocalAnim · B`. A clip
bake builds `A`/`B` once per track and applies them to every keyframe value (and
any CUBICSPLINE tangent, since left/right multiplication preserves the spline).
This satisfies the retarget invariant
`tgtAnimWorld · tgtRestWorld⁻¹ = srcAnimWorld · srcRestWorld⁻¹` (each bone
independent, parents assumed at bind — the standard approximation). When both
rigs share a bind orientation it reduces to copying the source rotation, so it
strictly generalizes ADR-0122's local form.

**`RetargetRig` carries rest world rotations.** Each `RetargetSlot` gains
`restWorldR` (the bone's rest world rotation) and `parentRestWorldR` (its
parent's). `buildHumanoidRetargetRig` captures both from the live skeleton's
propagated `GlobalTransform`s (decomposing out the bind scale). The `.rerig` wire
format bumps to version 2 to serialize them. A rig described without a live
skeleton (e.g. built from a source GLB's node hierarchy) supplies them directly.

**Hip/root translation is re-based by the root-frame alignment.** The hip motion
delta is rotated by `tgtParentRestWorld⁻¹ · srcParentRestWorld` (source root frame
→ target root frame) before the proportion scale, so root motion travels in the
target's space rather than the source's bind frame.

## Consequences

- A clip authored for any humanoid rig — including a differently-oriented
  animation pack — retargets correctly onto the target; the cross-orientation
  case that broke the local form is now the supported common case.
- `RetargetRig` is heavier (two extra quaternions per slot) and the `.rerig`
  format is v2; v1 files predate any release, so no migration is provided.
- The per-bone independence (parents assumed at bind) is the standard retarget
  approximation; long chains accrue negligible drift in practice, and foot/hand
  IK (ADR-0121) corrects residual contact error as ADR-0122 already specified.
- The transfer remains a pure clip-bake step (ADR-0122); no per-frame system, no
  GPU change, no schedule change.

## Implementation

- `packages/engine/src/animation/retarget/retarget-transfer.ts` —
  `retargetRotationFactors`, `applyRetargetFactors`, world-space `transferRotation`,
  `scaleRootTranslation` (now frame-rebased).
- `packages/engine/src/animation/retarget/retarget-rig.ts` — `RetargetSlot.restWorldR`
  / `parentRestWorldR`; `buildHumanoidRetargetRig` captures them.
- `packages/engine/src/animation/retarget/retarget-clip.ts` — `retargetClip` rebakes
  rotations via the world-space factors and re-bases hip translation.
- `packages/engine/src/animation/retarget/retarget-rig-asset.ts` — `.rerig` format v2.
