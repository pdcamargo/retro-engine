---
'@retro-engine/engine': minor
---

feat(engine): skinned + morphed pipeline variant

A mesh that is both skinned and morphed (a character with facial blend shapes) now deforms by both —
morph applied to the rest pose, then skinned — completing the runtime morph-target feature (ADR-0129).

- `pbr.wgsl`: when compiled with both `SKINNED` and `MORPHED`, the joint palette keeps `@group(3)`
  binding 0 and morph deltas/weights/params shift to 1/2/3 (binding numbers selected by `#define`, no
  collision). `apply_morph` already runs before `skin_matrix`.
- `MorphGpu`: a combined `@group(3)` layout (palette + morph) and `prepareEntity(..., paletteBuffer)`
  builds a per-entity bind group referencing the shared joint palette plus the mesh's morph data.
- `MaterialPlugin`: the skinned queue routes a `Skeleton`-bearing entity that also has `MorphWeights`
  to a `skinned: true, morphed: true` pipeline variant, binding the combined group and emitting one
  draw per such entity (it can't share an instanced batch). Skinned-only entities still batch.

Verified in the studio: a skinned cube with an "inflate" morph target both skins and visibly inflates
when its weight is driven 0→1. (`MorphGpu` no longer eagerly frees per-entity buffers on despawn —
the morph-only and combined queues share one entity map; tracked as a deferred cleanup.)
