# ADR-0127: Auto-retarget foreign clips on bind

- **Status:** Accepted
- **Date:** 2026-06-26

## Context

ADR-0122 built the retargeting engine (`retargetClip`, `RetargetRig`): given a
clip authored for one skeleton and a description of both rigs, it bakes a native
clip whose tracks address the target skeleton's bones. ADR-0126 gave a model's
animation clips persistent identity as composite GUID-URIs
(`"<modelGuid>#AnimationN"`), so a clip from one GLB can be assigned to a
`Handle<AnimationClip>` field on an entity instantiated from a *different* GLB
and survive scene save/reload.

What is still missing is the wiring between them. When a clip authored for model
A is assigned to a rig instantiated from model B, the clip's tracks address
A's node indices (`gltfNodeTargetId(n) = String(n)`), which do not name B's
bones. The clip either plays nothing, or — if the two models' node-index spaces
overlap, which they always do — drives the *wrong* bones. The goal of this
slice: assigning such a "foreign" clip Just Works, with no retarget UI and no
authoring step, at assign time and again on every scene load. A "native" clip
(same model as the rig) is untouched.

Two constraints shape the design:

- **Module boundary.** `gltf` depends on `engine`, never the reverse. The `Gltf`
  root, the `Gltfs` store, and `GltfSceneRoot` all live in `gltf`. Any code that
  reads a `Gltf` (to extract the source rig) or reads `GltfSceneRoot` (to know a
  rig's origin model) must live in `gltf`. The animation sampler lives in
  `engine` and cannot import `gltf`.
- **The scene stores only the original ref.** `AnimationPlayer.clip` is a
  serialized handle field; the save path writes `handle.guid`. The retargeted
  clip is derived, must never persist, and must re-derive on reload from the
  original `"<modelGuid>#AnimationN"` reference.

The roadmap left five open questions. They are settled below.

## Decision

**Reference-pose source — auto-derived, no human in the loop.** Commit `6c2d3d5`
turned the reference pose from a choice into a derivation: `computeReferencePose`
builds each rig's shared canonical-T-pose rotation from its own *bind bone
directions* and stores it on every `RetargetSlot` (`refWorldR` /
`parentRefWorldR`). Auto mode therefore builds both the source and target rig
with **no authored `referencePose` override** and gets the shared reference for
free — the case the roadmap flagged as "the hard one" no longer requires a human
to pick a reference. Root translation uses `animationScaled` (hip motion scaled
by the rigs' hip-height proportion), so a clip's locomotion survives onto a
differently-proportioned target; residual contact drift is the existing runtime
IK problem (ADR-0122), not this slice's.

**Architecture — engine owns a resolve-time indirection; `gltf` populates it.**
The authored `AnimationPlayer.clip` (and controller / layer clip handles) are
**never mutated**, so scene save trivially persists the original ref. Instead a
transient `EffectiveClips` resource in `engine` maps `(playerEntity, authored
clip handle index) → effective clip handle`; the sampler resolves every clip
through it. `engine` ships the resource and the sampler indirection and depends
on nothing from `gltf`. A bind-time system in `gltf` does the work that needs a
`Gltf` — detect foreign, extract the source rig, retarget, cache — and writes
the result into `EffectiveClips`. If no such system runs, the map is empty and
the sampler reads authored handles unchanged (status quo).

**Foreign detection — origin-model GUID, with target-id intersection as
fallback.** A clip is foreign to a rig when its origin model differs from the
rig's: `parseSubAssetGuid(clip.guid).parent ≠ playerEntity`'s
`GltfSceneRoot.handle.guid`. This is exact and cheap. The roadmap's proposed
target-id intersection is *not* reliable on its own — node-index id spaces
collide across models, so a foreign clip whose indices overlap a self-animated
rig's `AnimationTarget`s would read as native and drive wrong bones. Target-id
intersection is kept only as a fallback for rigs with no origin GUID (a
hand-built skeleton with no `GltfSceneRoot`).

**Cache identity — content-keyed, runtime-only.** A derived clip is keyed by
`(sourceClipGuid, targetRigSignature)`, where the signature is the target rig's
ordered `slot→boneId` mapping joined into a string. The key is content-based, so
every instance of the same rig shares one derived clip and the key is stable
across reload. Derived clips are added to the existing `AnimationClips` store
with **no GUID**; the cache and the `EffectiveClips` map are transient resources,
never serialized. Reload re-derives; nothing leaks into a saved scene. A player's
`EffectiveClips` entries are dropped when its clip assignment changes.

**Mapping failures — refuse, never produce a broken pose.** If either rig maps
too few humanoid slots (in particular, no `Hips`), the system logs a one-time
warning and does **not** retarget. The raw foreign clip then simply fails to
bind (its track ids don't name the target's bones) and the rig holds its rest
pose — a visible "nothing happened", never a scrambled skeleton.

**Async timing — suppress, don't flicker.** The source model may still be
loading when a player binds a foreign clip. Until its `Gltf` drains, the system
marks the clip *suppressed* (`EffectiveClips` entry = `null`), and the sampler
skips that contribution. No raw foreign clip is ever sampled, so there is no
wrong-bone frame; once the model is available the derived clip replaces the
suppression on a later frame.

**Reflection (CLAUDE.md §13).** No new authored component — derived clips, the
cache, and the effective-clip map are all runtime-only, recomputed each load.
There is therefore no new component schema, matching ADR-0122's minimal-surface
stance.

## Consequences

- Dropping any `A_*.glb` clip onto a foreign rig through the inspector picker
  animates it correctly, with no retarget UI; the scene saves the original
  sub-asset ref and the derived clip re-derives on reload. The capability is
  uniform across `AnimationPlayer`, `AnimationControllerPlayer`, and
  `AnimationLayers` because all three resolve clips through the one indirection.
- The hot sampling path gains one nested-map lookup per clip resolution; isolated
  in a bench. The retarget bake itself happens once per `(clip, rig)` pair, off
  the per-frame path, and its result is shared across rig instances.
- The authored field is never rewritten, so save/load correctness is structural
  rather than something the retarget path has to remember to undo.
- A rig with no recognizable humanoid bones, or a clip from an unmappable source
  rig, yields no motion plus a logged warning rather than a corrupted pose — the
  deliberate trade-off for "Just Works" with no authoring step.
- Detection by origin GUID means a rig instantiated outside the glTF path (no
  `GltfSceneRoot`) falls back to the weaker target-id heuristic; this is the
  documented limit, acceptable because the auto-retarget target is, by
  construction, a glTF-instantiated character.

## Implementation

- `packages/engine/src/animation/effective-clips.ts` — `EffectiveClips`,
  `effectiveClip`.
- `packages/engine/src/animation/animation-plugin.ts` — inserts the
  `EffectiveClips` resource.
- `packages/engine/src/animation/animation-system.ts` — routes single-clip,
  controller, and layer clip resolution through `effectiveClip`.
- `packages/engine/src/animation/index.ts`, `packages/engine/src/index.ts` —
  re-exports.
- `packages/gltf/src/retarget-rig-from-gltf.ts` —
  `buildHumanoidRetargetRigFromGltf`.
- `packages/gltf/src/gltf-auto-retarget.ts` — `addGltfAutoRetarget`. Ordered
  `after: ['gltf-instantiate', 'composition-override-apply']` so the target rig's
  rest pose is captured after a scene's composition overrides (e.g. an armature
  re-orientation) are applied; capturing earlier offsets the cached reference
  pose and tilts the whole retargeted result.
- `packages/gltf/src/gltf-plugin.ts` — registers the auto-retarget system, and
  `registerSubAssetStore('Animation', animationClips)` so a saved scene that
  references a model clip loads even in a host (e.g. the studio) that adds the
  `AssetServer` after the core plugins — `AnimationPlugin`'s own registration is
  skipped there because it guards on the server already existing at build time.
- `packages/gltf/src/index.ts` — re-exports.
- `packages/engine/bench/effective-clips.bench.ts` — per-frame lookup cost.
