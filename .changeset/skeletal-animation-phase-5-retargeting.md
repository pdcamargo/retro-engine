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

**`RetargetRig` asset** (`retarget-rig.ts`, `retarget-rig-asset.ts`, `retarget-reference-pose.ts`)
— a skeleton's rig description (kind `RetargetRig`, `.rerig`): each canonical `HumanoidSlot` → a
bone (clip-binding id) + that bone's rest pose (local TRS, rest **world** rotation) and its
**reference-pose** world rotation. The analogue of a Unity Avatar / Unreal IK Rig; carries no
entity references, so it is shareable and serializable. `buildHumanoidRetargetRig(world,
skeletonRoot, name?, opts?)` auto-maps a live skeleton by bone name (Unity "Configure Avatar"
auto-detect, covering Synty and Mixamo naming), captures the rest pose by forward kinematics
relative to `skeletonRoot`, and derives each bone's reference-pose rotation from the bind **bone
directions** (`bone → child` world vectors — position-based, so immune to per-bone axis re-roll and
container rotations). `opts.referencePose` authors that pose by hand per slot (the Unreal "retarget
pose" escape hatch).

**`retargetClip`** (`retarget-clip.ts`, `retarget-transfer.ts`) — `retargetClip(source,
sourceRig, targetRig, opts)` returns a new clip addressing the target's bones. Bone rotations
transfer as a **deviation from a shared reference pose** both rigs are posed into — a canonical
T-pose — rather than from each rig's own bind (`A · srcLocal · B`, constant factors per bone). So a
clip authored on an A-pose animation pack lands correctly on a T-pose target: at the source's rest
the target shows the source's rest *shape*, not its own bind — idle rests naturally, no T-pose, no
wrist flip (per ADR-0125). Hip/root translation is re-based into the target's root frame and scaled
by the rigs' height ratio (`animationScaled`) or dropped (`targetBindPose`); other bones'
translation and all scale tracks are dropped so the target keeps its own bone lengths. Residual
contact drift is corrected at runtime by the target rig's own foot/hand `TwoBoneIK` constraints
(ADR-0121). The `RetargetRig` carries reference-pose world rotations per slot (`.rerig` format v3).

**Humanoid profile + helpers** (`humanoid.ts`, `humanoid-mask.ts`, `bind-retarget-rig.ts`) — the
canonical `HumanoidSlot` set, `HUMANOID_BODY_PARTS`, and bone-name auto-map table.
`humanoidBodyPartMask(rig, parts)` builds an `AvatarMask` from canonical body parts
(head / arms / legs / torso) — resolving the humanoid body-part mask deferred from Phase 3.
`bindRetargetRig` tags a target skeleton's bones with `AnimationTarget`s so a retargeted clip
binds through the normal player.

`RetargetPlugin` registers the `.rerig` asset kind (added by `CorePlugin` after `IkPlugin`). Adds
a `retarget` bench (cost grows with bones × keyframes).
