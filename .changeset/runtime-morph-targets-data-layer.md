---
'@retro-engine/engine': minor
'@retro-engine/gltf': minor
---

feat(engine): morph-target data layer — `MorphWeights`, `MorphTargets`, glTF blend-shape import

The CPU/data half of runtime morph targets (glTF blend shapes), per ADR-0129. No GPU render
path yet — this lands the asset shapes, the authored component, and the import wiring so a glTF
with morph targets round-trips into the world with addressable weights.

**New public surface (`@retro-engine/engine`):**

- `MorphTarget` / `MorphTargets` — a mesh's static blend-shape delta store: named per-vertex
  position + normal deltas (NORMAL zero-filled when absent), parallel default weights. Attached to
  a `Mesh` via the new optional `Mesh.morphTargets` field.
- `MorphWeights` — authored component holding live per-target weights addressable by name
  (`names` / `weights`, `get` / `set` / `indexOf`, `MorphWeights.fromTargets`). Reflection schema
  registered by `MorphPlugin`, so it survives saved scenes and code reloads.
- `MorphPlugin` — registers the component; added to `CorePlugin` after `SkinningPlugin`.

**`@retro-engine/gltf`:**

- `mapPrimitiveToMesh` now decodes `primitive.targets` (POSITION/NORMAL deltas) into
  `Mesh.morphTargets`, naming targets from `mesh.extras.targetNames` and seeding default weights
  from `mesh.weights`. TANGENT deltas are ignored (the PBR shader needs no per-vertex tangent).
- Instantiation attaches a `MorphWeights` to morphing mesh nodes (single- and multi-primitive).
