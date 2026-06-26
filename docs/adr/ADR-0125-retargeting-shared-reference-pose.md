# ADR-0125: Retargeting — shared reference pose

- **Status:** Accepted
- **Date:** 2026-06-26
- **Supersedes:** ADR-0123, ADR-0124

## Context

ADR-0123 moved the retarget rotation transfer to world space; ADR-0124 added a
global frame alignment `G` from bind-pose body landmarks. Both transfer a bone's
motion as its **delta from each rig's own bind pose**:
`tgtAnimWorld · tgtBind⁻¹ = srcAnimWorld · srcBind⁻¹` (with `G` re-basing the
source binds into the target's frame). Verifying against the real workload showed
this is fundamentally insufficient.

The studio's target `Character.glb` rests in a **T-pose**; the Synty animation
packs (`A_Idle_*`, `A_Attack_*`, `A_Death_*`, FBX→glTF through Blender) rest in an
**A-pose**. A delta-from-bind transfer rests the target at *its own* bind, so at a
source frame near rest the target sits in its T-pose: a calm idle reads as a
character standing in a T-pose with small wobbles, and the wrists carry a residual
twist. Large motions (death, attack) only *looked* roughly right because the big
delta masked the wrong rest. `G` corrects the gross body facing/up-axis but not
the per-joint A-vs-T difference — it is a single rigid rotation for the whole body.

The established algorithms (three.js `SkeletonUtils`, the upf-gti solver, Unreal
IK-Rig, Unity humanoid) are explicit (CLAUDE.md §2): retargeting requires **both
skeletons posed in the same auxiliary/reference pose**. upf-gti's "embedded
rotations" exist precisely to bring each skeleton from its bind into that shared
pose. The fix is to transfer relative to a shared reference pose, not each rig's
bind.

## Decision

**Transfer each bone's motion as a deviation from a shared reference pose** — a
canonical T-pose both rigs are notionally posed into — instead of from each rig's
own bind. Target the world-space relation
`tgtWorld[b] = srcWorld[b] · srcRef[b]⁻¹ · tgtRef[b]` (strip the source's
reference orientation, apply the target's), where `srcRef`/`tgtRef` are the two
rigs' **reference-pose** world rotations. Converting to a target-local rotation
through the target's animated parent, the per-frame forward-kinematics world terms
telescope and cancel (`world[parent]⁻¹ · world[b] ≡ local[b]`), leaving an exact,
per-bone, frame-free transfer:

```
tgtLocal[b] = (tgtParentRef⁻¹ · srcParentRef) · srcLocal[b] · (srcRef⁻¹ · tgtRef)
            = A · srcLocal[b] · B
```

This is the **same `A · srcLocal · B` shape** as ADR-0123; it substitutes
reference-pose world rotations for bind-pose ones. At the source's rest the target
shows the source's rest *shape* (the A-pose), not its own bind. A separate global
alignment `G` is no longer needed — a shared per-bone reference frame subsumes it.

**Each rig's reference pose is auto-derived from bind bone directions.** For each
bone, `refWorld[b] = canonFrame[slot] · bindFrame[b]⁻¹ · restWorld[b]`, where
`bindFrame[b]` is an orthonormal frame whose primary axis is the bind bone
direction (`bone → child` world vector — **position-based**, so immune to the
per-bone local-axis re-roll and container rotations two exports disagree on) and
whose twist is fixed by a per-slot secondary axis (the rig's measured forward for
most bones; up for the feet, whose forward is parallel to the world forward).
`canonFrame[slot]` is the shared canonical T-pose frame (arms ±X, legs −Y, spine
+Y, feet +Z). Because both rigs use the *same* `canonFrame` per slot, it cancels
out of the final transfer factors — its role is to make the stored reference
rotations a recognizable pose (so an authored override is meaningful), while the
geometric `bindFrame` is what actually re-bases the motion. The reference of an
unmapped ancestor (the bone above the hips) is its bind orientation, so the root
container difference is still absorbed there.

**An authored reference pose overrides the derived one** per slot
(`buildHumanoidRetargetRig(..., { referencePose })`) — the Unreal "retarget pose"
escape hatch for a rig whose bind the direction heuristic reads wrong.

**`RetargetRig` carries reference-pose rotations.** Each `RetargetSlot` gains
`refWorldR` and `parentRefWorldR` (alongside the retained `restWorldR` /
`parentRestWorldR`); the `.rerig` wire format bumps to version 3. The hip
proportion ratio is taken from each hip's **distance from the skeleton root**
(`‖restWorldT‖`), not its Y component alone, since the root-relative bind can
carry hip height off the Y axis.

## Consequences

- A clip authored on an A-pose rig retargets correctly onto a T-pose target: idle
  rests naturally, no T-pose, no wrist flip; attack/death keep reading correctly.
  The transfer is exact (the FK terms cancel), not the per-bone bind-parent
  approximation ADR-0123 carried.
- The fix is concentrated: the transfer-factor math is unchanged in shape, so the
  per-keyframe bake cost is identical; the new work is one-time per-rig reference
  derivation. `G` / `bodyFrameAlignment` is removed.
- The auto-derivation assumes a roughly humanoid bind (bones point toward their
  mapped children, limbs lie in the body's coronal plane). A wildly non-humanoid
  rig falls back per-bone to its bind orientation when a frame is degenerate, and
  the authored override is the escape hatch for the rest.
- `RetargetRig` carries two more quaternions per slot; `.rerig` is v3 (v1/v2
  predate any release, so no migration is provided).
- Still a pure clip-bake step (ADR-0122): no per-frame system, no GPU change, no
  schedule change. Residual contact drift is corrected at runtime by the target
  rig's own foot/hand IK (ADR-0121), as ADR-0122 specified.

## Implementation

- `packages/engine/src/animation/retarget/retarget-reference-pose.ts` —
  `frameFromAxes`, the canonical direction/secondary/child tables, and
  `computeReferencePose` (with `ReferencePoseBone` / `ReferencePoseEntry` /
  `AuthoredReferencePose`).
- `packages/engine/src/animation/retarget/retarget-rig.ts` —
  `RetargetSlot.refWorldR` / `parentRefWorldR`; `buildHumanoidRetargetRig`
  tracks parent slots, derives the reference pose, and takes
  `BuildRetargetRigOptions.referencePose`.
- `packages/engine/src/animation/retarget/retarget-transfer.ts` —
  `retargetRotationFactors` / `transferRotation` operate on reference-pose
  rotations; `proportionRatio` takes hip heights; `bodyFrameAlignment` removed.
- `packages/engine/src/animation/retarget/retarget-clip.ts` — `retargetClip`
  feeds reference-pose rotations to the factors (no `G`) and takes the proportion
  ratio from `‖hip.restWorldT‖`.
- `packages/engine/src/animation/retarget/retarget-rig-asset.ts` — `.rerig`
  format v3.
- `packages/engine/src/animation/retarget/index.ts`, `…/animation/index.ts`,
  `packages/engine/src/index.ts` — export `computeReferencePose` / `frameFromAxes`
  / the reference-pose types; drop `bodyFrameAlignment`.
