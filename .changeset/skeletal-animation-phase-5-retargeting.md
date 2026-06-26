---
'@retro-engine/engine': minor
---

feat(engine): skeletal-animation Phase 5 — animation retargeting

Per ADR-0122, a clip authored for one skeleton plays on a differently-proportioned one — take a
GLB's animation and use it on another character. Retargeting is a **clip-production** step, not a
per-frame component: it bakes a source clip into an ordinary native `AnimationClip` for the
target, the way Unity (humanoid bake) and Unreal ("Export Retargeted Animations") do. So the
output flows through the existing `AnimationPlayer` / `AnimationController` / blend trees /
`AnimationLayers` and the Phase-4 IK post-pass with no special handling — N clips from M source
rigs become N first-class clips on a character. No new authored component, no new per-frame
system, no GPU work beyond Phase 0.

**`RetargetRig` asset** (`retarget-rig.ts`, `retarget-rig-asset.ts`) — a skeleton's rig
description (kind `RetargetRig`, `.rerig`): each canonical `HumanoidSlot` → a bone (clip-binding
id) + that bone's rest pose (local TRS + rest **world** rotation). The analogue of a Unity Avatar /
Unreal IK Rig; carries no entity references, so it is shareable and serializable.
`buildHumanoidRetargetRig(world, skeletonRoot)` auto-maps a live skeleton by bone name (Unity
"Configure Avatar" auto-detect, covering Synty and Mixamo naming) and captures the rest pose. Rest
world rotations are accumulated by forward kinematics over local rotations, **seeded with the
skeleton's ancestor world rotation** (composed up the `Parent` chain) so they sit in the same
true-world frame as the bind positions — even when a glTF container above the skeleton carries an
axis-conversion rotation — which the global alignment depends on.

**`retargetClip`** (`retarget-clip.ts`, `retarget-transfer.ts`) — `retargetClip(source,
sourceRig, targetRig, opts)` returns a new clip addressing the target's bones. Bone rotations
transfer through both rigs' rest **world** rotations (`A · srcLocal · B`, constant factors per
bone), so motion crosses skeletons that rest in different bind orientations — the usual case for
a downloaded animation pack (per ADR-0123). A **global frame alignment** computed from each rig's
bind-pose body landmarks (up = Head−Hips, side = UpperLeg_L−UpperLeg_R — position-based, so it is
immune to per-bone axis conventions) re-bases the source into the target's frame, so packs authored
facing a different direction or up-axis land upright instead of inverted/spinning (per ADR-0124).
Hip/root translation is re-based into the target's root frame and scaled by the rigs' height ratio
(`animationScaled`) or dropped (`targetBindPose`); other bones' translation and all scale tracks
are dropped so the target keeps its own bone lengths. Residual contact drift is corrected at
runtime by the target rig's own foot/hand `TwoBoneIK` constraints (ADR-0121). The `RetargetRig`
carries rest world rotations per slot (`.rerig` format v2).

**Humanoid profile + helpers** (`humanoid.ts`, `humanoid-mask.ts`, `bind-retarget-rig.ts`) — the
canonical `HumanoidSlot` set, `HUMANOID_BODY_PARTS`, and bone-name auto-map table.
`humanoidBodyPartMask(rig, parts)` builds an `AvatarMask` from canonical body parts
(head / arms / legs / torso) — resolving the humanoid body-part mask deferred from Phase 3.
`bindRetargetRig` tags a target skeleton's bones with `AnimationTarget`s so a retargeted clip
binds through the normal player.

`RetargetPlugin` registers the `.rerig` asset kind (added by `CorePlugin` after `IkPlugin`). Adds
a `retarget` bench (cost grows with bones × keyframes).
