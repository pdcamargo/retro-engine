# ADR-0130: MakeHuman `.target` ingestion — sparse morph-target assets

- **Status:** Accepted
- **Date:** 2026-06-27

## Context

RetroHuman's face/body customization (roadmap Phase 3) needs the full MakeHuman target set — nose
size, ear shape, jaw, proportions — which the glTF blend-shape path cannot carry (1,258 targets,
37.7 MB, far too many to ship through a GLB or hold as live vertex attributes; ADR-0129). MakeHuman's
raw data is a directory of `.target` files: plain text, one per slider direction, each a **sparse**
list of `vertexIndex dx dy dz` lines moving a handful of the base mesh's 19,158 vertices. The targets
are **topology-locked** to `base.obj` — an index is only meaningful against that exact vertex order.

We need these discoverable as engine assets (GUID-identified via `.meta`, ADR-0111), loadable, and
validated for index alignment, so Phase 3 can compose them onto a base mesh.

## Decision

- **One `.target` file = one discoverable asset**, kind `'MorphTarget'`, extension `target`,
  `discoverable: true`, category `'morph'`. This is the natural ADR-0111 file→asset mapping — no
  invented manifest/library file format. A "morph library" (the cohesive named set the character
  creator drives) is realized as the **collection** of `MorphTarget` assets the creator gathers
  (Phase 3), not a separate on-disk container in v1.
- The asset value is `SparseMorphTarget` — `{ name, indices: Uint32Array, deltas: Float32Array }` —
  storing only moved vertices (a nose tweak is ~200 of 19,158 vertices, a few KB, not a full delta
  buffer). It exposes `maxIndex`, `fitsBase(n)`, and `toDense(n)` (expand to a full per-vertex delta).
- The parser (`parseSparseMorphTarget`) is pure and strict: it throws on a malformed line (wrong
  field count, non-integer/negative index, non-finite delta) rather than skipping — topology-locked
  data, so a parse error is corruption, not noise. MakeHuman's leading-dot floats (`-.011`) parse
  natively.
- **Topology-lock validation happens at composition, not import.** A `.target` file carries no
  base-mesh reference, so the importer only checks well-formedness; index-vs-base alignment
  (`maxIndex < baseVertexCount`) is enforced when the target is composed onto a concrete base mesh
  (`fitsBase` / `toDense` throw on overflow). This keeps the asset base-agnostic and defers the check
  to where the base vertex count is actually known.
- **Vendor vs fetch:** the asset *type* is committed; the asset *data* is not. The full 37.7 MB set
  stays fetch-on-demand (`vendor/makehuman/fetch.sh --full`); the staged 290 facial targets are a
  pinned working set, not committed to any shipped package; tests use small inline fixtures. No bulk
  CC0 binary enters git history. (Resolves the roadmap's vendor-vs-fetch open question: fetch-on-demand.)

This is distinct from the dense glTF blend shape (`MorphTarget`, a full per-vertex delta with normals;
ADR-0129): that is the runtime curated-small-N expression path; `SparseMorphTarget` is the edit-time
full-customization path. `SparseMorphTarget.toDense` bridges the two when a sparse target is baked.

## Consequences

- Per-file granularity means each `.target` dropped into a project mints a `.meta` — a large
  customization set is many sidecars. Acceptable: the working set is curated, and the alternative (a
  manifest container) is premature until Phase 3 shows a need.
- The character creator (Phase 3) owns "which targets, grouped how, driving which sliders" — the
  asset layer stays a flat catalog of named sparse deltas. MakeHuman's own `targets/target.json`
  catalog can seed that grouping later without changing the asset model.
- Sparse storage keeps a full facial set small in memory; `toDense` is paid only when a target is
  actually composed/baked.
- Base-agnostic targets can be mis-applied to the wrong base mesh; `fitsBase`/`toDense` reject an
  out-of-range index, so the failure is a clear error, not silent corruption.

## Implementation

- `packages/engine/src/morph/sparse-morph-target.ts` — `SparseMorphTarget`, `parseSparseMorphTarget`.
- `packages/engine/src/morph/sparse-morph-target-asset.ts` — `SparseMorphTargets` store,
  `createSparseMorphTargetImporter`, `SPARSE_MORPH_TARGET_ASSET_KIND`.
- `packages/engine/src/morph/morph-plugin.ts` — registers the kind / store / `.target` loader.
- `packages/editor-sdk/src/components-asset.ts` — `'morph'` `AssetType`;
  `apps/studio/src/project/project-browser.ts` — `morph` category mapping.
- `vendor/makehuman/` — pinned CC0 source + `fetch.sh` (data fetch-on-demand, not committed to packages).
