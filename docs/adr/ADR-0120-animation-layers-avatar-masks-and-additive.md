# ADR-0120: Animation layers, avatar masks, and additive blending

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

Phase 3 of the skeletal-animation initiative adds the Unity-style layering the
roadmap calls for: a rig plays several animations at once, each scoped to part of
the body and combined either by replacement or by adding a delta. A "wave" plays
on the spine and arms over a full-body "run"; a "lean" or "breath" adds a subtle
offset on top of whatever is playing.

This builds entirely on the Phase-2 pose pipeline (ADR-0118): clips/controllers
sample into a transient SoA `Pose` (per-bone local TRS, slot-addressed), blend
via sign-aligned accumulated nlerp with **per-field per-slot weights**, and
commit to bone `Transform`s once in the `update` stage before propagation →
skinning. It is pure pose math — no new GPU work beyond Phase 0. The seam
ADR-0118 left open ("Masks — explicitly excluding bones — and additive poses
remain Phase 3") is exactly what this resolves.

Three industry references were checked rather than assumed (CLAUDE.md §2):

- **Unity** evaluates layers by ascending index (base = 0 first). Each layer has
  a weight; **Override** blends `lerp(below, layer, weight·mask)`; **Additive**
  adds the layer's delta-from-reference, leaving lower layers at full strength. An
  **Avatar Mask** restricts which transforms a layer writes — binary, per
  transform, for generic rigs.
- **Bevy** masks are a bitfield of mask groups per animation target; a set bit
  *disables* a node's effect on that group — confirming masking is binary per
  bone.
- **Additive** (ozz / Cocos): a delta against a reference pose,
  `t_delta = t_clip − t_ref`, `r_delta = ref⁻¹ · clip`, `s_delta = clip / ref`,
  applied with weight `w` as `t += w·t_delta`, `r = base · nlerp(identity,
  r_delta, w)`, `s *= lerp(1, s_delta, w)`.

## Decision

### AvatarMask is an asset — a binary, bone-id-keyed include set

A new `AvatarMask` asset (kind `AvatarMask`, extension `.ramask`) is a set of
bone target ids a layer is allowed to write, keyed on the same
`AnimationTarget.id` clips already bind through (a glTF node index as a string,
or a bone name). Membership is **binary** (in/out) — the Unity generic/Transform
mask, not weighted. A layer with no mask affects every bone its motion animates.
The asset is reusable and shareable across layers and rig instances, registered
through the standard asset-kind flow (store `AvatarMasks`, JSON importer/
serializer, sidecar) exactly like `AnimationClip`/`AnimationController`.

This is the **generic** mask. The Unity humanoid **body-part toggle**
(head/arms/legs by standardized silhouette) is deferred to Phase 5, because it
requires the canonical humanoid-avatar abstraction (bone → standardized body
part) that retargeting introduces; once that exists, a body-part toggle is sugar
that resolves to the same bone-id set. This is a dependency-ordering decision,
not a scope cut (CLAUDE.md §12). The studio **mask-authoring UI** (a bone-tree
checkbox panel with an "include subtree" helper) is likewise out of scope here —
masks are driven via code/MCP for now, the same posture ADR-0119 took for the
controller graph editor. The runtime asset is in scope; the editor panel is
separable tooling.

### Layers are a new `AnimationLayers` component, not a change to the controller

A rig's layer stack is a new `AnimationLayers` component, holding an ordered
list of layers (bottom/base first). Each layer carries a `weight`, a blend mode
(`override` | `additive`), an optional `mask` handle, and a motion `source` that
is **either a clip or a full `AnimationController`**. This is composition beside
the sealed ADR-0119 `AnimationController` (a single state machine), not a change
to it: putting layers inside the controller would reinterpret a sealed asset and
force every layer to be a full state machine. A component-level stack keeps the
controller frozen, lets a bare-clip layer stay cheap (the common base bob /
additive breath), and is the natural per-rig neighbor for the Phase-4 IK
constraints and Phase-5 rig mapping that attach to the same rig. A layer that
*wants* a state machine references a controller, so the Unity per-layer-machine
workflow is available, just not mandatory. The existing single-clip
`AnimationPlayer` and single-controller `AnimationControllerPlayer` are untouched
and drive entities that don't have `AnimationLayers`.

### Each layer evaluates to a pose, then composes into one accumulator

The layered driver, per player per frame: builds one **shared slot layout**
across the union of every bone any layer could animate (so the accumulator, each
layer pose, and the reference pose share slot indices); evaluates each layer
bottom-up into a scratch pose with the Phase-2 machinery (clip cursor or stepped
state machine → weighted motion inputs → accumulate → `finalizePose`); then
composes that finalized pose into the accumulator, gated per slot by the layer's
mask:

- **Override** — per masked bone and per field the layer animates: blend
  `lerp(acc, layer, weight)` (sign-aligned nlerp for rotation) where the
  accumulator already has a value, else take the layer value outright. Masked-out
  or layer-untouched fields keep the accumulator, so a lower layer shows through
  wherever the upper one does not write. The bottom layer onto an empty
  accumulator is the same operation (seeds the pose).
- **Additive** — per masked bone and field the layer animates: add the
  delta-from-reference using the math above, with the reference standing in as
  the base where nothing below animated the bone.

The accumulator commits to bone `Transform`s exactly once, as in ADR-0118 — only
fields some layer wrote are committed, so masked-out bones keep their authored
values. Propagation and skinning run downstream, unchanged. The per-field
per-slot weights ADR-0118 built are the seam this rides: masking gates which
slots a layer touches; the accumulator's per-field "has a value" flag drives the
commit and the override base-vs-blend choice.

### Additive reference pose = the glTF bind pose, captured lazily

The reference an additive delta is subtracted against is the rig's **bind/rest
pose** — each bone's local TRS as instantiated from the glTF skin. **Why bind
pose over an authored reference clip:** it is always present in any rigged glTF
(zero authoring burden), it is the natural neutral a breath/lean delta is
relative to, and it doubles as the "rest" base for additive bones no lower layer
animated. An authored reference clip is the more flexible Unity path but adds an
asset and an authoring step; the layer data model leaves room for a per-layer
reference override, deferred until there is a need. The reference is captured
**lazily** the first frame a bone appears in a layered player, reading its local
`Transform` before any layer writes it — for a glTF-instantiated rig that is the
bind pose. It is held in a transient `ReferencePoses` resource keyed by player
and bone id. The one assumption: a scene saved with bones frozen mid-animation
would capture that frozen pose as the reference; acceptable, and noted here.

### Reflection (CLAUDE.md §13)

`AnimationLayers` is authored: its `layers` array (each `weight`, `blend`,
optional `mask` handle, and a `clip`/`controller` source variant with that
source's playback settings and a controller layer's parameters) has a schema,
registered by `AnimationPlugin`. `AvatarMask` is an asset (serializer), not a
component schema. The transient runtime — per-layer clip cursor, per-layer
controller state machine, and the captured reference poses — lives in the
`AnimationLayerRuntimes` and `ReferencePoses` resources, never on the component
and never serialized (derived state, like `AnimationPoses` and
`AnimationControllerRuntimes`).

## Consequences

- A rig can play masked, layered, additive animation with no GPU change: layers
  are pose math inserted between Phase-2's blend and Phase-2's commit.
- Layer composition cost is `bones × layers` per frame, isolated in a bench
  (`layer-blend.bench.ts`) alongside the existing pose-blend bench.
- Override against an empty accumulator IS the base-layer seed, so there is one
  composition path, not a special base case.
- Additive blending is order-dependent (it post-multiplies onto the running
  accumulator) — inherent and standard.
- Masking is binary per bone; weighted/humanoid masks are a later, additive
  capability that resolves to the same include-set seam.
- One more asset kind to publish (`.ramask`); the studio shows it under the
  existing `animation` category (no studio change).

## Implementation

- `packages/engine/src/animation/avatar-mask.ts` — `AvatarMask`.
- `packages/engine/src/animation/avatar-mask-asset.ts` — `AvatarMasks`,
  `AVATAR_MASK_ASSET_KIND`, importer/serializer.
- `packages/engine/src/animation/layer-blend.ts` — `composeLayerOverride`,
  `composeLayerAdditive`, `LayerMask`.
- `packages/engine/src/animation/animation-layers.ts` — `AnimationLayers`,
  `AnimationLayer`, `LayerSource`, `AnimationLayerRuntimes`, `ReferencePoses`.
- `packages/engine/src/animation/animation-system.ts` — `accumulateInputsIntoPose`,
  `applyNonBoneTracks`, `collectLayerClips`, `evaluateLayerInputs`, and the
  layered driver in `addAnimationSampling`.
- `packages/engine/src/animation/animation-plugin.ts` — registers the
  `AvatarMask` kind/store/serializer/loader, the `AnimationLayers` schema, and
  the `AnimationLayerRuntimes` / `ReferencePoses` resources.
- `packages/engine/bench/layer-blend.bench.ts` — layer compose hot path
  (bones × layers).
