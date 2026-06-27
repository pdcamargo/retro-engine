# ADR-0131: Character base mesh (vertex-order OBJ) + CPU morph composition

- **Status:** Accepted
- **Date:** 2026-06-27

## Context

RetroHuman's character creator (roadmap Phase 3) reshapes a base humanoid by driving MakeHuman
`.target` weights, then bakes the result. Two foundations are needed before the panel: getting the
MakeHuman base mesh into the engine, and composing weighted sparse targets onto it.

The base is `vendor/makehuman/base.obj` — a Wavefront OBJ, 19,158 vertices, **quad** faces (`v/vt`,
no normals), 21,334 UVs (more than vertices → UV seams). The engine loads glTF, not OBJ. The
`.target` ingestion (ADR-0130) keys deltas by base-mesh **vertex (`v`) index**.

The tension: a general OBJ importer **splits** a position into several GPU vertices wherever it
carries different UVs/normals across faces. With 21k UVs over 19k positions, that renumbers the
vertices — and `.target` indices keyed to `v` order no longer address the right vertices. Morph
alignment is the whole point, so a general importer is the wrong tool here.

## Decision

- **A vertex-order-preserving OBJ loader** (`parseObjBaseMesh`), not a general OBJ asset importer:
  one mesh vertex per OBJ `v` line, in file order. Every face index collapses to its position index,
  so the mesh stays in `v` order and a `.target` keyed by `v` index aligns vertex-for-vertex. The
  cost is one UV per position (first seen at a seam) — acceptable for the creator's base preview,
  where morph alignment matters and seam UVs do not. Quads (and n-gons) are fan-triangulated; the
  source has no normals, so smooth normals are computed; a per-position UV is always emitted (so the
  mesh satisfies UV-requiring shaders — cf. the UV-less freeze bug). This is **not** registered as a
  general `obj` asset kind: a split-by-attribute OBJ importer is a separate, later concern that must
  not be confused with the morph-aligned base loader.
- **CPU morph composition** (`composeMorphedPositions`): `out[v] = base[v] + Σ weightᵢ · deltaᵢ[v]`,
  computed sparsely (cost `Σ targetᵢ.count`, not `vertexCount × targetCount`). Zero-weight targets
  skipped; out-of-range indices skipped (degrade to no-op, never corrupt neighbours). Edit-time only
  — drag a slider, recompose, re-upload the mesh; no runtime/GPU morph cost. Benched (it is the
  slider-drag interaction path).
- **Scope: edit-time bake, confirmed.** The creator composes on the CPU and bakes a static result.
  Runtime in-game customization (live sliders moving the mesh while the game runs) stays a Phase 5
  *future* (resident deltas in a storage buffer, WebGPU-only). This resolves the roadmap's
  "edit-time bake vs runtime-live" open question for the initial scope.

## Consequences

- The base mesh is morph-ready: `parseObjBaseMesh(base.obj)` → a 19,158-vertex mesh whose vertex `i`
  is `.target` index `i`, so `composeMorphedPositions` applies any aligned target directly.
- Seam UVs are lossy on the base preview (one UV per position). The **bake** (later slice) can do a
  proper attribute-split export if a textured result needs per-seam UVs; the live preview does not.
- No general OBJ import yet — only this morph-aligned base loader. A future general `.obj` asset kind
  is unblocked but deliberately out of scope (and must keep this loader's v-order variant for morph).
- `base.obj` stays fetch-on-demand (git-ignored, ADR-0130); the loader reads whatever the project /
  vendor provides. Tests use small synthetic OBJ fixtures; real-data parsing was verified against the
  vendored base (19,158 verts, 110,916 indices, normals computed).
- CPU composition keeps the creator WebGL2-safe and zero-runtime-cost, at the price of a recompose +
  re-upload per edit — fine for an authoring interaction, measured by the bench.

## Implementation

- `packages/engine/src/morph/obj-base-mesh.ts` — `parseObjBaseMesh`.
- `packages/engine/src/morph/morph-compose.ts` — `composeMorphedPositions`, `WeightedMorphTarget`.
- `packages/engine/bench/morph-compose.bench.ts` — composition bench.
- Consumes `SparseMorphTarget` / `parseSparseMorphTarget` (ADR-0130) and `Mesh` / `computeSmoothNormals`.
