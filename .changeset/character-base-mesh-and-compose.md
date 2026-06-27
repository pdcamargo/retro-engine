---
'@retro-engine/engine': minor
---

feat(engine): character base mesh (vertex-order OBJ) + CPU morph composition

The two foundations the RetroHuman character creator builds on (ADR-0131):

- `parseObjBaseMesh` — a **vertex-order-preserving** OBJ→`Mesh` loader: one mesh vertex per OBJ `v`
  line in file order, so a sparse morph target keyed by `v` index aligns vertex-for-vertex. Quads
  (and n-gons) are fan-triangulated, smooth normals are computed (OBJ carries none), one UV per
  position is emitted. Deliberately not a general OBJ importer — a general one splits positions by
  UV/normal seams and would break morph alignment (the MakeHuman base has 21k UVs over 19k vertices).
- `composeMorphedPositions` — `out[v] = base[v] + Σ weightᵢ·deltaᵢ[v]`, computed sparsely (cost
  `Σ targetᵢ.count`, not `vertexCount × targetCount`), with `WeightedMorphTarget`. The edit-time
  character-creator composition (drag a slider, recompose, re-upload) — no runtime/GPU morph cost.
  Benched (the slider-drag path; ~36 µs for the 19,158-vertex base with 40 active targets).

Verified on the real vendored `base.obj` (19,158 vertices, 110,916 triangulated indices). Confirms
the roadmap's edit-time-bake scope; runtime-live customization remains a Phase 5 future.
