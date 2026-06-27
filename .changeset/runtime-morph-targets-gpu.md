---
'@retro-engine/engine': minor
---

feat(engine): morph-target GPU render path (`MORPHED` pipeline variant)

The GPU half of runtime morph targets (ADR-0129). A mesh's `MorphWeights` now visibly deform it in
the vertex shader, on a WebGPU storage-buffer path mirroring GPU skinning.

- `MorphGpu` (render resource): per-mesh blend-shape delta storage buffer (target-major,
  position+normal, std430), per-entity weights + params buffers, and the `@group(3)` bind group the
  morphed pipeline reads. Gated on `RendererCapabilities.storageBuffers`.
- `MorphInstanceBuffer` / `makeMorphedDraw`: one draw per morphed entity (morphed meshes are unique,
  not instance-batched), reusing the rigid per-instance transform layout.
- `packMorphDeltas` / `MORPH_DELTA_FLOATS`: the pure delta packer (benched — cost grows with
  vertices × targets).
- `MaterialPlugin`: a `material-queue-morphed` queue and a `morphed` pipeline-key variant
  (`#ifdef MORPHED` in `pbr.wgsl` — morph applied before skinning); morphed entities are excluded
  from the rigid queue when storage buffers are available (else they fall back to base geometry).
- `pbr.wgsl`: `apply_morph` blends per-target weighted position/normal deltas indexed by
  `@builtin(vertex_index)` (minus the mesh's slab base vertex).

Verified in the studio: a glTF morph target driven 0→1 deforms the live mesh. WebGL2 path and
prepass participation for morphed meshes are deferred (ADR-0129).
