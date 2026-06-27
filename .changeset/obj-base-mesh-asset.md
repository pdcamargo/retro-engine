---
'@retro-engine/engine': minor
---

feat(engine): `.obj` source meshes load as vertex-order base meshes

Registers an `ObjMesh` asset kind (extension `obj`, discoverable, category `mesh`) so a Wavefront OBJ
dropped into a project is discovered, sidecar'd, and loaded into the shared `Meshes` store via
`parseObjBaseMesh` (the vertex-order-preserving loader from ADR-0131) — one mesh vertex per OBJ `v`
line, so a MakeHuman `.target` keyed by `v` index aligns with it. A `Mesh3d` references the result
like any other mesh.

This is the morph-aligned base loader, not a general OBJ importer (positions stay in file order;
seam UVs collapse to one per vertex). A general split-by-attribute OBJ import is deferred.

Verified live: `base.obj` is discovered as `ObjMesh`, loads into a 19,158-vertex `Mesh`, renders, and
the character-creator composition (sparse delta apply + `computeSmoothNormals` + re-upload via
`Meshes.getMut`) reshapes it without disturbing the renderer.
