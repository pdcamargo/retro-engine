# ADR-0114: GPU skinning data model and render path

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

The engine imports skinned glTF as a skeleton hierarchy only: joint nodes become entities with
`Transform`/`Parent`/`Children`, and gated transform propagation correctly updates a moved bone's
`GlobalTransform`. Nothing downstream consumed it. The render path was root-only rigid instancing —
one `GlobalTransform` matrix per drawable, packed as a per-instance vertex attribute
(`material-plugin.ts` queue → `instance-layout.ts` pack → `pbr.wgsl` model multiply). Bones were
attachment anchors, not deformers; moving a bone deformed nothing.

This ADR introduces the data model and render-path split that make a skinned mesh deform. The GPU
delivery mechanism for the joint palette is a separate decision ([ADR-0115](ADR-0115-joint-palette-gpu-delivery.md)).

This is Phase 0 of the skeletal-animation initiative — the floor every later phase (clip playback,
pose pipeline, layers/masks, IK, retargeting) builds on.

## Decision

- **Skinning vertex attributes.** `MeshAttribute` gains `JOINT_WEIGHT` (id 6, `float32x4`) and
  `JOINT_INDEX` (id 7, `uint16x4`, read as `vec4<u32>`), mirroring Bevy's well-known slot ids. The
  glTF importer stops skipping `JOINTS_0`/`WEIGHTS_0`; joint indices are widened to `Uint16Array`
  (not float-converted), weights decode as floats. They are inserted ahead of `TANGENT`/`COLOR_0` in
  the canonical attribute order so joints/weights occupy **shader locations 3 and 4** whenever
  present, regardless of which optional trailing attributes a mesh carries.

- **`Skeleton` is authored, serialized state.** A `Skeleton` component on the skinned mesh entity
  holds the ordered joint **entity** references (palette order) and the parallel **inverse bind
  matrices** decoded from the glTF skin. It has a reflection schema (`joints: array(entity)`,
  `inverseBindMatrices: array(mat4)`) registered by its owning plugin, so a skinned instance
  survives a saved scene and a hot reload.

- **The joint palette is derived, transient, non-serialized state.** Per skinned entity each frame,
  `palette[i] = inverse(meshGlobal) · jointGlobal[i] · inverseBind[i]`. It is recomputed from the
  current pose every frame and is never registered or saved — the same category as `GlobalTransform`.
  Palettes live in a main-world `SkinnedPalettes` resource keyed by entity, filled by a system that
  runs in `postUpdate` **after** `transform-propagation`. This formula keeps the existing per-instance
  model-matrix multiply intact: the skinned vertex shader computes `world_pos = model · skinMat ·
  position`, and `model · inverse(meshGlobal)` cancels, yielding the world-space joint transform.
  Skinning slots in front of the rigid model multiply; the rigid path's matrix handling is untouched.

- **The render path splits skinned from rigid.** A skinned mesh cannot share the rigid instance
  batch: it draws with a different pipeline variant (`#ifdef SKINNED`) and a different per-instance
  layout (model + inverse-transpose + a `joint_offset: u32` base index into the shared palette). The
  material queue runs two extracted queries against the main world — the rigid query gains
  `{ without: [Skeleton] }`, a new skinned query selects `[…, Skeleton]` — so an entity is drawn by
  exactly one path. Skinned instances of the same mesh+material still batch and instance together; the
  `joint_offset` is per-instance data.

- **Phase 0 scope limits (documented, not silent).** Skinned meshes do not participate in the depth /
  motion-vector prepass and are not combined with SSAO in the same view (both stem from the bind-group
  budget — see ADR-0115). These are sequencing limits, lifted in later work, not capability ceilings.

## Consequences

- Moving a bone's `Transform` now deforms the mesh — the Phase 0 acceptance behavior and the
  prerequisite for clip playback, blending, IK, and retargeting.
- Skinned and rigid meshes coexist in one scene, each on its own pipeline; rigid throughput is
  unchanged because the rigid query simply excludes skinned entities.
- Palette recomputation is per-frame and grows with `entities × joints`; it is on the per-frame chain
  and is benched.
- A skinned mesh that loses its `Skeleton` (or whose joints are missing) falls back to drawing rigid —
  it renders undeformed rather than disappearing.
- Skinned + prepass and skinned + SSAO are deferred; a scene needing both on the same view is not yet
  supported.

## Implementation

- `packages/engine/src/mesh/vertex-attribute.ts` — `MeshAttribute.JOINT_WEIGHT`, `MeshAttribute.JOINT_INDEX`
- `packages/engine/src/skinning/skeleton.ts` — `Skeleton`, `SkinnedMeshPalette`
- `packages/engine/src/skinning/palette.ts` — `computeSkinningPalette`, `SkinnedPalettes`
- `packages/engine/src/skinning/skinned-instance-layout.ts` — `SKINNED_INSTANCE_LAYOUT`, `packSkinnedInstance`
- `packages/engine/src/skinning/skinning-plugin.ts` — `SkinningPlugin` (registers `Skeleton`, palette system)
- `packages/engine/src/material/material-plugin.ts` — skinned query path, `key.skinned`, skinned pipeline + layout
- `packages/engine/src/material/pbr.wgsl.ts` — `#ifdef SKINNED` vertex variant
- `packages/gltf/src/{schema.ts,gltf-root.ts,build-gltf-root.ts,mesh-mapping.ts,gltf-instantiate.ts}` — skin extraction + `Skeleton` attach
