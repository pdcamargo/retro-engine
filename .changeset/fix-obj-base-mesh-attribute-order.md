---
'@retro-engine/engine': patch
---

fix(engine): OBJ base mesh + bake insert NORMAL before UV (correct shader binding)

`parseObjBaseMesh` and `bakeMorphedMesh` inserted `POSITION, UV_0`, then appended
`NORMAL` last (via `computeSmoothNormals`). The vertex-buffer layout follows
insertion order, and the PBR shader binds `@location(0/1/2) = POSITION/NORMAL/UV`
— so UV data was fed into the `normal` input and normals into `uv`, rendering the
base mesh (and any baked character) with wrong lighting and wrong texturing
(silently, since the format mismatch defaults rather than failing). They now insert
a `NORMAL` placeholder before `UV_0` (overwritten in place by `computeSmoothNormals`),
giving the canonical `POSITION, NORMAL, UV` order. The glТF path was already
correct and is unaffected.
