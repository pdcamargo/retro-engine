---
'@retro-engine/reflect': minor
'@retro-engine/engine': minor
'@retro-engine/gltf': minor
'@retro-engine/editor-sdk': patch
---

feat(engine): skeletal-animation Phase 1 — clip playback (general property-animation system)

Per ADR-0116 and ADR-0117, the engine gains a general keyframe-animation system: a clip is a
set of tracks, each a **reflected property path + a keyframe sampler**, so a clip can animate
any reflected field — bone `Transform`s, a light's `intensity`, a material color. Skeletal
animation is the case where tracks target bone TRS; the Phase-0 skinning path then deforms the
mesh automatically from the animated `GlobalTransform`s.

**`@retro-engine/reflect`** — property-path machinery moves here as the shared source of truth
for "what an inspector edits" and "what a clip animates":

- `FieldPath` / `FieldPathSegment`, `readPath`, `writePathLeaf`, `pathKeyOf` — relocated from
  `editor-sdk` (which now re-exports them).
- `resolveFieldType(schema, path)` — walks a registered schema to the leaf `FieldType`, so a
  caller learns a property's `kind` (and thus how to interpolate it) from its address.

**`@retro-engine/engine`** — new `animation/` module:

- `AnimationClip` asset (`.ranim`, registered via the asset-kind flow): `duration` + `tracks`,
  each track a `TrackTarget` (`targetId` + component name + `FieldPath`) and a `KeyframeSampler`
  (times/values/`componentCount`/interpolation).
- `sampleInto` — pure LINEAR / STEP / CUBICSPLINE sampler; quaternion tracks use shortest-path
  spherical interpolation, vectors/scalars linear, with the glTF CUBICSPLINE tangent layout.
- `AnimationPlayer` (clip handle + `speed`/`playing`/`repeat`; transient `time` cursor) and
  `AnimationTarget` (`id` + `player`) components, both with reflection schemas.
- `AnimationPlugin` (added by `CorePlugin`) + the sampling system, which advances each player and
  writes its clip's tracks into the bound entities. Runs in the `update` stage, before
  `postUpdate` transform propagation, so a clip driving bone `Transform`s deforms the skinned
  mesh the same frame.

**`@retro-engine/gltf`** — glTF `animations` are parsed into `AnimationClip`s whose tracks target
node TRS (`Gltf.animationClips`); instantiation tags spawned nodes with `AnimationTarget` so a
clip binds to the spawned bones. Morph-weight channels are parsed but skipped pending
morph-target mesh support.

**`@retro-engine/editor-sdk`** — `edit/field-path` re-exports the path machinery from `reflect`
(no behaviour change; one source of truth).
