# ADR-0122: Animation retargeting — rig-mapping, clip-production, and contact pinning

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

Phase 5 — the final phase of the skeletal-animation initiative — lets a clip
authored for one skeleton play on a differently-proportioned one. Concretely:
take a GLB's animation (e.g. an animation-only Synty/Mixamo file) and use it on
another character. It builds on the Phase-2 pose pipeline (ADR-0118), the
Phase-3 `AvatarMask` (ADR-0120), and — for contact — the Phase-4 IK constraints
(ADR-0121), whose entity-reference target + per-constraint weight ADR-0121
explicitly designed as the seam retargeting reuses.

Three industry models were researched rather than assumed (CLAUDE.md §2):

- **Unreal IK Rig + IK Retargeter (chain-based):** each skeleton has an *IK Rig*
  — named retarget chains (spine, arms, legs, root) + a reference pose. An *IK
  Retargeter* maps source→target chains, **copies rotation** from the source
  animation, and chooses a **translation mode** (target bind pose, or animation
  scaled by the proportion ratio); IK chains pin hands/feet. "Export Retargeted
  Animations" **bakes** source clips into native target clips. General, not
  human-only.
- **Unity Mecanim (humanoid):** import-time retargeting bakes each clip into
  proportion-free **muscle space**; a per-model **Avatar** maps the rig's bones
  to a canonical humanoid. A retargeted clip is then a **normal clip** any
  Humanoid Avatar plays, with foot/hand IK fixing contact drift. Human-only,
  needs the Avatar.
- **Bevy:** no real retargeter — name-matched bone playback only (a clip plays
  on any armature whose bone names match). Recorded honestly as the low end.

The transfer math (three.js retargeting, Wicked Engine) is **rest-pose-relative
rotation transfer**: apply the source bone's rotation delta from its own rest
pose onto the target bone's rest pose, in each bone's local space —
`tgtLocal = tgtRest · (srcRest⁻¹ · srcAnim)`. Because this is associative, for a
fixed pair of rests it is the constant left-multiply `tgtRest · srcRest⁻¹`
applied to every animated rotation. Rotations carry no length, so the transfer
is inherently proportion-independent; only root/hip **translation** is scaled by
the height ratio, and residual contact drift (feet sliding on a taller target)
is a runtime IK problem, not a transfer-math one.

## Decision

**Model — chain-based / rig-mapping abstraction, not muscle space.** Phase 5
ships the canonical-humanoid-slot rig mapping (the general primitive the roadmap
points at): not human-only in structure, reuses the existing pose + IK stack,
and the deferred Phase-3 humanoid body-part mask resolves over the same slots.
Unity's normalized muscle space (human-only, needs muscle-limit metadata and a
heavier per-model avatar) is recorded as the deferred alternative for a large
shared humanoid clip library; it is a sequencing/scope choice, not a genre cut
(CLAUDE.md §12).

**Retargeting is clip production, not a per-frame component.** This is the
load-bearing API decision, stress-tested against the real workload — many clips
from several source rigs, all used on one character. A per-clip *runtime*
retarget component would force the user to re-bind a source rig on every clip
**and** would be a parallel playback path that does not compose with the
Phase-2/3 controllers, blend trees, and layers. Both Unity and Unreal instead
retarget **into native clips**: `retargetClip(source, sourceRig, targetRig)`
returns an ordinary `AnimationClip` whose tracks address the target skeleton's
bones. The source binding is per-skeleton (once), the target per-character
(once), and every output is a first-class clip that flows through
`AnimationPlayer` / `AnimationController` / blend trees / `AnimationLayers` and
the IK post-pass with **no new authored component and no new per-frame system**.

**`RetargetRig` is a rig-description asset.** A `RetargetRig` (kind `RetargetRig`,
`.rerig`) maps each canonical `HumanoidSlot` to a bone (a clip-binding id) plus
that bone's **rest** local TRS and rest world translation — the analogue of a
Unity Avatar / Unreal IK Rig. It carries no entity references, so it is
shareable and serializable. `buildHumanoidRetargetRig(world, skeletonRoot)`
auto-maps a live skeleton by bone name (Unity "Configure Avatar" auto-detect)
and captures the rest pose from each bone's current local `Transform` (the bind
pose for a freshly instantiated rig — the same lazy-capture principle as
ADR-0120's `ReferencePoses`, here eager and stored in the asset so a clip can be
retargeted without the source skeleton present). The canonical
profile — `HumanoidSlot`, `HUMANOID_SLOTS`, `HUMANOID_BODY_PARTS`, and the
bone-name alias table — is fixed code, not serialized.

**Transfer — rest-relative rotation in local space; hip translation scaled.**
`retargetClip` maps each source bone track to its canonical slot (via the source
rig), then per slot: **rotation** tracks re-bake with `tgtRest · srcRest⁻¹`
applied to every keyframe value (and any CUBICSPLINE tangent, since the shift is
constant), addressed to the target bone; the **hip** translation track re-bakes
as `tgtRest + ratio · (anim − srcRest)` where `ratio` is the rigs' hip
rest-world-height quotient (`animationScaled`), or is **dropped** so the target
holds its own stance (`targetBindPose`). All **other** bones' translation and
all scale tracks are dropped, so the target keeps its own bind-pose bone
lengths — this is what makes the clip proportion-independent. Tracks for bones
neither rig maps (and non-`Transform` tracks) are dropped. The chosen
local-space transfer is exact for rigs that share a bind orientation (the same
skeleton family, the common GLB-animation-on-another-character case); the
cross-orientation world-space generalization (three.js's full
`invBindTrgParent · … · bindTrg` form) is the documented extension if a future
rig pair needs it.

**Contact pinning reuses the Phase-4 IK post-pass — no new schedule stage.**
Because a retargeted clip is an ordinary clip, retargeting adds **nothing** to
the per-frame schedule. The clip rides the existing `update`-stage
sample→blend→commit (ADR-0118); `postUpdate` propagation then feeds the ADR-0121
`ik-solve` (after `transform-propagation`, before `skinning-compute-palettes`),
where the target rig's own foot/hand `TwoBoneIK` constraints — configured once
per character — pin contacts despite the residual proportion drift. The
roadmap's open "where does retarget evaluation sit relative to commit /
propagation / IK" resolves to: *retarget happens entirely before runtime, at
clip-bake time; the IK post-pass is what corrects contacts at runtime,
unchanged.*

**Humanoid body-part mask resolves here.** `humanoidBodyPartMask(rig, parts)`
builds an `AvatarMask` (a bone-id include set) from canonical body parts
(head / arms / legs / torso) via `HUMANOID_BODY_PARTS` → slots → the rig's bone
ids. This discharges the Phase-3 deferral (ADR-0120): the humanoid mask is sugar
over the same include set, now that the canonical slot abstraction exists.

**Binding helper.** `bindRetargetRig(world, skeletonRoot, rig)` tags a target
skeleton's humanoid bones with `AnimationTarget`s (only where absent) so a
retargeted clip binds through the normal player — needed for a character
imported without its own animation (the common retarget target), harmless for
one that already has tags.

**Reflection (CLAUDE.md §13).** `RetargetRig` is an asset (serializer), like
`AvatarMask` / `AnimationClip` — not a component schema. Retargeted outputs are
ordinary `AnimationClip`s. There is **no new authored component**, so no new
component schema; the minimal surface is the point. A future runtime/live-mirror
retarget *player* would compose the same `transferRotation` /
`scaleRootTranslation` primitives and get its schema then.

## Consequences

- N clips from M source rigs become N first-class clips on a character: build M
  source rigs + 1 target rig (auto), `retargetClip` each, then use them in any
  controller / blend tree / layer with no further retarget config. The animation
  stack from Phases 1–4 is reused wholesale.
- Retargeted clips duplicate keyframe data (the Unity/Unreal bake trade-off);
  the win is composability and zero per-frame cost. Rotations are valid across
  the whole target rig family (proportion-independent); only the hip-translation
  height is baked at one ratio and contact is fixed live by IK.
- Bake cost grows with bones × keyframes, isolated in a bench
  (`retarget.bench.ts`) alongside pose-blend / layer-blend / ik-solve.
- The local-space transfer assumes matching bind orientation; cross-orientation
  rig pairs are the documented world-space extension, not yet built.
- No new GPU work beyond Phase 0; no new render path, capability flag, or
  schedule stage.

## Implementation

- `packages/engine/src/animation/retarget/humanoid.ts` — `HumanoidSlot`,
  `HUMANOID_SLOTS`, `HumanoidBodyPart`, `HUMANOID_BODY_PARTS`, `slotForBoneName`.
- `packages/engine/src/animation/retarget/retarget-rig.ts` — `RetargetRig`,
  `RetargetSlot`, `buildHumanoidRetargetRig`.
- `packages/engine/src/animation/retarget/retarget-rig-asset.ts` —
  `RetargetRigs`, `RETARGET_RIG_ASSET_KIND`, importer/serializer.
- `packages/engine/src/animation/retarget/retarget-transfer.ts` —
  `transferRotation`, `scaleRootTranslation`, `proportionRatio`,
  `RootTranslationMode`.
- `packages/engine/src/animation/retarget/retarget-clip.ts` — `retargetClip`,
  `RetargetClipOptions`.
- `packages/engine/src/animation/retarget/humanoid-mask.ts` —
  `humanoidBodyPartMask`.
- `packages/engine/src/animation/retarget/bind-retarget-rig.ts` —
  `bindRetargetRig`.
- `packages/engine/src/animation/retarget/retarget-plugin.ts` — `RetargetPlugin`
  (registers the `RetargetRig` asset kind only); `core-plugin.ts` adds it after
  `IkPlugin`.
- `packages/engine/src/animation/retarget/index.ts`,
  `packages/engine/src/animation/index.ts`, `packages/engine/src/index.ts` —
  public re-exports.
- `packages/engine/bench/retarget.bench.ts` — clip-bake hot path
  (bones × keyframes).
