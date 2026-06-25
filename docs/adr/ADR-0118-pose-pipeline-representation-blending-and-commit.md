# ADR-0118: Pose pipeline — representation, blending, and the commit-once boundary

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

Phase 1 of the skeletal-animation initiative (ADR-0116, ADR-0117) samples an
`AnimationClip`'s tracks **directly into component fields**: the sampling system
resolves each track's reflected property path on a bound component and writes the
sampled value in place, marking the component changed so `postUpdate` propagation
picks it up. That is the engine's general keyframe system — it animates any
reflected property (a light's intensity, a material's color), not just bones.

Phase 2 is the architectural pivot the whole "Unity-like" stack hangs off
(animation layers/masks, IK, and retargeting all consume it). Instead of sampling
straight into `Transform`, animation must produce a **pose** (per-bone local TRS),
poses must **blend** (weighted blend of N sources for blend trees and crossfades),
and the blended result must be committed to bone `Transform`s **exactly once** per
frame. Three decisions follow: how a pose is represented and stored, how the blend
math handles N weighted quaternions, and where the commit sits relative to the
Phase-0 propagation → skinning chain — all without regressing Phase 1's general
property animation. A fourth, deferred decision is revisited here: whether to
extract a dedicated animation package now (ADR-0117 flagged Phase 2 as the moment
to reconsider).

## Decision

**Pose representation — SoA `Float32Array`s, transient, resource-held, not
serialized.** A pose is per-bone local translation/rotation/scale held as a
structure of arrays (`t`/`s` three floats per bone, `r` four), addressed by a slot
index, with a parallel slot → bone-entity map for commit. SoA because the hot path
is a tight per-bone blend loop over typed arrays (it mirrors the skinning palette's
flat `Float32Array`). Poses are recomputed every frame and held in an
`AnimationPoses` resource keyed by the player entity (mirroring `SkinnedPalettes`),
**not** a registered component — so they never enter archetype storage or a saved
scene. This resolves the roadmap's open "pose representation" question. Per
CLAUDE.md §13 a pose is deliberately-not-serialized derived state; it interacts
with ECS change detection only at the commit boundary.

**Blend math — sign-aligned accumulated nlerp.** Translation and scale are
weighted sums divided by their accumulated weight (a weighted average).
Rotations use accumulated nlerp: the first contributor fixes the hemisphere, each
later quaternion is negated when its dot with the running accumulator is negative
(quaternion double cover), and the accumulated sum is renormalized once. This is
the established real-time choice (Bevy/Unity); it is cheaper than N−1 pairwise
slerps and, like them, order-dependent for >2 sources. Weights are tracked
**per field per slot**, so a clip that drives only some bones — or only a bone's
rotation — leaves the untouched fields at their authored values rather than
collapsing them toward identity.

**Bone-track vs arbitrary-property split.** Pose blending is bone-TRS-specific. A
track whose target component is `Transform` and whose path is a whole field
(`translation`/`rotation`/`scale`) routes into the pose; **every other track
writes directly**, exactly as in Phase 1. Blending of arbitrary scalar/color
properties is out of scope for this phase. When multiple sources write the same
non-bone property, the dominant (later-listed, higher-weight) source wins
last-writer-wins.

**Commit-once placement.** Sample → blend → commit all run in the **`update`**
stage, consistent with ADR-0117, so the ordering is preserved: commit (update) →
propagate `GlobalTransform` (postUpdate) → skinning palette (postUpdate, after
propagation). A blended controller pose deforms the skinned mesh the same frame.
Even a single-clip `AnimationPlayer` now routes its bone tracks through a
one-source pose committed once — value-identical to Phase 1 (a single weight-1
source normalizes to the sampled value), which is the "reframe."

**Animation package home — defer extraction again.** ADR-0117 deferred a
dedicated `@retro-engine/animation` package to Phase 2. We defer again. The honest
reason is coupling, not genre (CLAUDE.md §12): the animation layer depends
inescapably on engine core types (`Transform`, `App`, `Time`, the schedule, asset
registration, the skinning hook), so an extracted package would still depend on
`engine` — a thin non-leaf layer, not a clean boundary. Worse, `engine`'s
`CorePlugin` adds `AnimationPlugin` so the clip store exists before any `gltf`
build (`gltf → engine`); extracting forces `engine ↛ animation`, so `CorePlugin`
could no longer own `AnimationPlugin` and `gltf` would gain a direct dependency on
the new package. That reshuffle is orthogonal to Phase 2's deliverable and buys
nothing yet. Revisit when animation gains a consumer outside `engine`, or sheds its
dependence on engine core types.

## Consequences

- The pose buffer is the single bone path for both player types and the seam
  Phase 3 (layers/masks) and Phase 4 (IK) extend — a layer stack inserts between
  blend and commit; IK adjusts the committed locals/globals before the palette.
- Per-field per-slot weights make partial coverage correct without masks: a source
  that omits a bone (or a bone's rotation) simply does not contribute there. Masks
  (explicitly excluding bones) and additive poses remain Phase 3.
- Blending >2 quaternions is order-dependent (inherent to nlerp accumulation);
  acceptable and standard. Slot layout is rebuilt each frame (O(tracks)); a cached
  layout is a later optimization if profiling demands it.
- One fewer package to publish; the move to `@retro-engine/animation` stays a
  mechanical relocation behind the same public exports if it is ever justified.

## Implementation

- `packages/engine/src/animation/pose.ts` — `Pose`, `AnimationPoses`.
- `packages/engine/src/animation/pose-blend.ts` — `accumulateTranslation`,
  `accumulateRotation`, `accumulateScale`, `finalizePose`, `samplePoseFromClip`,
  `commitPoseToTransforms`, `boneTrackField`.
- `packages/engine/src/animation/animation-system.ts` — `addAnimationSampling`
  (evaluate → blend → commit; non-bone direct writes).
- `packages/engine/src/animation/animation-plugin.ts` — registers `AnimationPoses`.
- `packages/engine/bench/pose-blend.bench.ts` — blend hot path (bones × sources).
