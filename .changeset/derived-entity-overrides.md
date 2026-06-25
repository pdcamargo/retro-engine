---
'@retro-engine/reflect': minor
'@retro-engine/engine': minor
'@retro-engine/gltf': minor
---

feat(engine): persist edits to derived (instanced) entities as automatic overrides

Per ADR-0113 (supersedes ADR-0112). Editing an instantiated glTF model's nodes —
hiding a child, renaming a bone, nudging a transform, adding/removing a
component, deleting a node — now survives save/reload, with no manual anchoring:
the user edits a derived entity like any other and the deltas round-trip.

A subtree's pristine state is snapshotted at instantiation (`CompositionBaseline`,
runtime-only). On save, each derived entity is diffed against it and only the
changes are recorded on the mount as `SerializedEntity.derived[]`
(`set` field-level patches / `add` / `remove` / `deleted`), addressed by stable
anchor — derived entities are still excluded as full entities. On load, the model
re-instantiates and a generic engine system re-applies the deltas once a matching
resolver reports the subtree ready.

**New public surface:**

- `@retro-engine/reflect`: `diffComponent`, `FieldOverride` — field-level encoded
  diff producing only the changed fields.
- `@retro-engine/engine`: `CompositionBaseline` / `CompositionBaselineEntry`,
  `PendingCompositionOverrides`, `CompositionResolver` /
  `CompositionResolverRegistry` (load-time `kind`-keyed resolution seam),
  `SerializedDerivedOverride` + `SerializedEntity.derived`.
- `@retro-engine/gltf`: `addGltfBaselineCapture`; `GltfNodeAnchor.primitive`
  (addresses per-primitive mesh children); `GltfInstanceNodes.derivedEntities`.

**Behaviour changes:**

- The glTF composition provider now excludes every entity the model produced
  (node entities **and** per-primitive mesh children), and registers a
  `gltf-node` resolver. A model swap drops the baseline so it is recaptured
  against the new model. An untouched instance serializes byte-identically to
  before. `CorePlugin` inserts `CompositionResolverRegistry` and registers the
  generic `composition-override-apply` system; the glTF attachment rebind now
  runs after it.
