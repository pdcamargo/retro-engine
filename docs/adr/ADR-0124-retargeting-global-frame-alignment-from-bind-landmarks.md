# ADR-0124: Retargeting — global frame alignment from bind-pose body landmarks

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

ADR-0123 moved the retarget rotation transfer to world space so motion crosses
skeletons that rest with different **per-bone** local-axis conventions. Testing
two Synty animation packs (`A_Death_B_01_Sword`, `A_Attack_HeavyFlourish01_Sword`,
converted FBX→glTF through Blender) onto the studio's `Character.glb` exposed a
second, distinct failure: the retargeted character came out **inverted and
spinning**, not a recognizable animation.

Researching the established algorithms (three.js `SkeletonUtils`, the upf-gti
retargeting solver) clarified why (CLAUDE.md §2). The rest-relative world transfer
only holds when both skeletons share an **auxiliary (bind) pose orientation** —
"each retargeted bone has the same direction in world space for both avatars."
The three.js formula silently assumes this; the upf-gti solver handles a mismatch
with "embedded" rotations applied to the skeleton *container*. The converted packs
violate it: the Blender pipeline parks a 90° axis conversion on the Armature, and
the two characters' bind poses face ~different directions, so the source's world
rotations live in a different global frame than the target's. That global
difference `G` is exactly what the per-bone formula drops.

The hard part is computing `G` automatically. Raw bind **rotations** are unusable
here — they fold in the per-bone axis conventions the two exports disagree on (the
hips' bind rotations differed ~90° even though the bodies were ~16° apart). Bind
**positions** do not: they describe the skeleton's shape and facing independent of
how each bone rolls about itself.

## Decision

**Derive `G` from each rig's bind-pose body frame, built from bone world
positions.** For both rigs, build an orthonormal frame from three bind landmarks:
`up = Head − Hips`, `side = LeftUpperLeg − RightUpperLeg`, `forward = up × side`
(re-orthogonalized). The alignment is `G = B_target · B_sourceᵀ`, the rotation
mapping source-world vectors into the target's frame. Because it is built from
**positions**, it is immune to the per-bone local-axis conventions ADR-0123's
formula already absorbs — the two concerns are cleanly separated: `G` fixes the
*global* facing/up difference, the world-rotation factors fix the *per-bone* one.

`retargetClip` computes `G` once from the two `RetargetRig`s' landmark
`restWorldT`s and re-bases the source's bind world rotations through it before
building the transfer factors (`A = tgtParentRest⁻¹ · G · srcParentRest`,
`B = (G · srcRest)⁻¹ · tgtRest`); the hip-translation frame rebase applies `G`
too. When the landmarks are missing or degenerate (coincident, or up ∥ side) the
alignment falls back to identity, so a rig pair already co-oriented — or a minimal
rig without legs/head — retargets unchanged. This is the automatic equivalent of
the manual "retarget pose" alignment Unreal's IK Retargeter requires; it removes
the assumption that source and target are authored facing the same way.

## Consequences

- Animation packs authored facing a different direction or in a different
  up-axis than the target now retarget upright and recognizable — the inverted/
  spinning failure is resolved. Validated on the Synty death + attack packs onto
  the Character rig.
- `G` is a single rigid rotation for the whole body; it corrects global facing,
  not per-limb skew (which the ADR-0123 factors handle). A rig whose proportions
  or landmark layout are wildly non-humanoid would get a poor `G`; the identity
  fallback keeps such a case no worse than ADR-0123 alone.
- The alignment needs three landmark slots (Hips, Head, both upper legs) to carry
  bind world positions; `buildHumanoidRetargetRig` already captures `restWorldT`,
  and a rig built from a source asset's node hierarchy must populate it too.
- Still a pure clip-bake step (ADR-0122) — no per-frame cost, no schedule change.
  Root-motion *translation* fidelity across large orientation gaps remains the
  documented rough edge (foot/hand IK corrects contact, per ADR-0122).

## Implementation

- `packages/engine/src/animation/retarget/retarget-transfer.ts` —
  `bodyFrameAlignment` (and the internal `bodyFrameInto` frame builder with its
  degeneracy guard).
- `packages/engine/src/animation/retarget/retarget-clip.ts` — `retargetClip`
  computes `G` from the rigs' landmark `restWorldT`s and threads it through
  `rebakeRotation` / `rebakeRootTranslation`.
- `packages/engine/src/animation/retarget/index.ts`, `…/animation/index.ts`,
  `packages/engine/src/index.ts` — `bodyFrameAlignment` re-export.
