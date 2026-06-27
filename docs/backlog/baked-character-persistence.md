# Persist baked characters (`.rmesh` + GLB export)

The character-creator bake (ADR-0132) currently produces an **in-memory** `Mesh` asset spawned as an
entity. It renders and is riggable, but does not survive a studio reload and is not a first-class
project asset. Two follow-ups, deliberately deferred from Phase 3:

- **Persist to `.rmesh`.** Serialize the baked `Mesh` with the existing `createMeshSerializer`
  (`MESH_FORMAT_VERSION`) and write it to the project via the studio's project sink, minting a `.meta`
  sidecar (`generate-sidecars` path). Then the baked character is a discoverable, reloadable asset the
  scene can reference by GUID. Contained — reuses existing save infrastructure.
- **GLB export of a baked character.** `packages/gltf` has an importer but no exporter. A minimal
  glTF/GLB writer (positions/normals/UVs/indices/material, later skeleton + skin) would let a baked
  RetroHuman leave the engine for interchange and match the roadmap's original "GLB" wording. Larger;
  its own ADR when promoted.

Until these land, bake is an edit-time, in-session operation.
