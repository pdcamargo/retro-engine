# ADR-0116: Animation clip data model and property-path addressing

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

Phase 0 of the skeletal-animation initiative shipped GPU skinning: moving a bone's
`Transform` deforms a skinned mesh through propagation → joint palette → skinned shader
(ADR-0114, ADR-0115). Nothing yet *drives* those bone transforms over time.

Phase 1 needs a clip-playback system. The design choice is whether to build a
bone-specific player or a general keyframe system. The references (Bevy's `AnimationClip`/
`AnimationPlayer`, Godot's `AnimationPlayer`, Unity's Animation window) are all *general*:
a clip is a set of **tracks**, each track an addressed property plus a keyframe curve.
Skeletal animation is the special case where tracks happen to target bone `Transform`
translation/rotation/scale.

The engine already has the machinery to make a track address any property: the reflection
system (ADR-0060/0061) gives every registered component a schema of typed fields, and the
inspector already reads/writes nested fields by a string-segment path. glTF imposes a
concrete subset (node TRS + morph weights, with LINEAR/STEP/CUBICSPLINE interpolation) that
the clip format must represent but must not be limited to.

## Decision

**A clip is a set of tracks; a track is a reflected property path plus a keyframe sampler.**

- **`AnimationClip`** = `duration` (seconds) + `tracks[]`. It is an **asset**
  (`Assets<AnimationClip>`, `.ranim` JSON), not a component — registered through the
  asset-kind flow, produced by the glTF importer or authored directly.
- **`AnimationTrack`** = a `TrackTarget` + a `KeyframeSampler`.
- **`TrackTarget`** = `{ targetId, component, path }`. `component` is a registered
  component's stable reflection name (e.g. `'Transform'`); `path` is a reflected
  `FieldPath` within it; `targetId` is an opaque string that binds to an entity at play
  time (see ADR-0117). A track can therefore address *any* reflected field — a light's
  `intensity`, a material color, a transform — not just a bone.
- **`KeyframeSampler`** = parallel `times`/`values` `Float32Array`s, a logical
  `componentCount` (1 scalar, 3 vec3, 4 vec4/quat), and an `interpolation` mode.

**Property-path addressing lives in `@retro-engine/reflect`.** `readPath`/`writePathLeaf`/
`pathKeyOf` and `resolveFieldType(schema, path)` move from `editor-sdk` down to `reflect`,
the leaf package both the editor and the engine already depend on. `editor-sdk` re-exports
them under its historical names. This makes the path machinery the inspector edits with the
*same one* an animation track drives — one source of truth, no drift.

**Interpolation is chosen from the leaf's reflected `FieldType.kind`, not guessed from
value width.** Walking the target component's schema along the path yields the leaf field
type; `quat` → shortest-path spherical slerp, `vec2`/`vec3`/`vec4`/`number`/`color` →
component-wise linear, others → step-held. This is what lets one sampler serve both a
4-float quaternion (slerp) and a 4-float `vec4`/color (lerp) correctly.

**Interpolation modes mirror glTF 2.0:** `LINEAR`, `STEP`, `CUBICSPLINE` (cubic Hermite,
per-keyframe in/out tangents scaled by the keyframe duration, quaternion results
renormalized). LINEAR quaternion blending is shortest-path (negate the far endpoint when
the dot product is negative).

**glTF channel → track mapping** produces `Transform` translation/rotation/scale tracks,
addressing nodes by their document-index id. **Morph-weight (`weights`) channels are parsed
but skipped** — the engine has no morph-target mesh support yet, so there is nothing to
drive. This is a tracked technical gap (revisited when morph targets land), not a genre
limitation: the clip *format* stays general; only this glTF mapping is TRS-shaped.

## Consequences

- A clip can animate any reflected property, so the same system covers skeletal animation,
  UI/material/light tweening, and gameplay-component animation with no new types.
- Reusing the inspector's path machinery means a property editable in the inspector is
  animatable by a clip, and vice versa — they cannot diverge.
- Sampling is allocation-free on the hot path: vectors/quaternions are written in place
  into the live component field; scalars/colors use a reused scratch.
- glTF morph-target animations import as clips with fewer tracks than the source until
  morph-target meshes exist; the dropped channels are recoverable from the source.
- CUBICSPLINE support carries the 3×-stride tangent layout in the sampler; STEP/LINEAR use
  a 1×-stride layout. The sampler interprets the stride from the mode, so the two coexist
  without a per-keyframe tag.
- Method/event tracks (fire a callback at a keyframe) are explicitly **out of scope** for
  the v1 format; adding them later is additive (a new track variant), not a reshape.

## Implementation

- `packages/reflect/src/field-path.ts` — `FieldPath`, `FieldPathSegment`, `readPath`,
  `writePathLeaf`, `pathKeyOf`, `resolveFieldType`; re-exported from
  `packages/reflect/src/index.ts`.
- `packages/editor-sdk/src/edit/field-path.ts` — re-exports the above from `reflect`.
- `packages/engine/src/animation/animation-clip.ts` — `AnimationClip`, `AnimationTrack`,
  `TrackTarget`, `KeyframeSampler`, `Interpolation`, `clipDuration`.
- `packages/engine/src/animation/sampler.ts` — `sampleInto` (LINEAR/STEP/CUBICSPLINE,
  shortest-path quaternion slerp).
- `packages/engine/src/animation/animation-clip-asset.ts` — `AnimationClips`,
  `createAnimationClipImporter`, `createAnimationClipSerializer`, `ANIMATION_CLIP_ASSET_KIND`.
- `packages/gltf/src/animation-mapping.ts` — `mapAnimations`, `gltfNodeTargetId`.
- `packages/gltf/src/schema.ts` — `GltfAnimation`, `GltfAnimationChannel`,
  `GltfAnimationSampler`, `GltfInterpolation`; `GltfDocument.animations`.
- `packages/gltf/src/gltf-root.ts` / `build-gltf-root.ts` — `Gltf.animationClips`.
