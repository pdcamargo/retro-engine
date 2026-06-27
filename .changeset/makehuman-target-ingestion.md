---
'@retro-engine/engine': minor
'@retro-engine/editor-sdk': minor
---

feat(engine): MakeHuman `.target` ingestion — sparse morph-target assets

Ingests MakeHuman's topology-locked `.target` files as discoverable engine assets, the edit-time
full-customization data RetroHuman's character creator composes onto a base mesh (ADR-0130).

- `SparseMorphTarget` + `parseSparseMorphTarget` (`@retro-engine/engine`): a sparse per-vertex
  position delta set (`name`, `indices`, `deltas`) storing only moved vertices, with `maxIndex`,
  `fitsBase(n)`, and `toDense(n)`. The strict parser handles MakeHuman's `vertexIndex dx dy dz` lines
  (leading-dot floats, `#` comments) and throws on corruption.
- Asset kind `'MorphTarget'` (extension `target`, discoverable, category `morph`): `SparseMorphTargets`
  store + `createSparseMorphTargetImporter`, registered by `MorphPlugin`. A loose `.target` file mints
  a `.meta` and loads through the AssetServer. Topology-lock (index-vs-base alignment) is validated at
  composition (`fitsBase`/`toDense`), since a `.target` carries no base-mesh reference.
- `@retro-engine/editor-sdk`: a `'morph'` `AssetType` (scan-face icon) so the studio browser shows
  morph targets with their own category.

Verified in the studio: a vendored MakeHuman `.target` dropped into a project is discovered, sidecar'd
as `MorphTarget`, and loads into a `SparseMorphTarget` (311 vertices, indices within the base's 19,158).
