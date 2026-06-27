# Bug: OBJ base mesh inserts NORMAL after UV → swapped vertex inputs

> **Status: fixed in code, pending confirmation.** `parseObjBaseMesh` +
> `bakeMorphedMesh` now insert `NORMAL` before `UV_0` (canonical
> `POSITION, NORMAL, UV`), unit-tested for order. Delete this file once the base
> mesh is confirmed to light + texture correctly in the studio.

## Symptom

The MakeHuman base mesh (and any baked character from it) renders with wrong
per-vertex normals and wrong UVs: lighting looks off and a textured material
samples the wrong coordinates. Geometry (positions) is correct, so the bug is
easy to miss with an untextured, roughly-lit material.

## Root cause

The PBR vertex shader binds mesh attributes by a fixed `@location`:
`@location(0) position`, `@location(1) normal`, `@location(2) uv`
(`packages/engine/src/material/pbr.wgsl.ts`). The renderer builds a mesh's
vertex-buffer layout from its attribute **insertion order**, assigning
`shaderLocation = i` in that order (`interMeshVertexBufferLayout` /
`uploadMesh` in `packages/engine/src/mesh/`).

`parseObjBaseMesh` inserts `POSITION`, then `UV_0`, then calls
`computeSmoothNormals` which appends `NORMAL` last — yielding order
`POSITION(0), UV_0(1), NORMAL(2)`. So `@location(1)` receives UV data (read as
`normal`) and `@location(2)` receives normal data (read as `uv`). The format
mismatch (float32x2 → vec3) does not fail pipeline creation (missing components
default), so it renders silently wrong.

`bakeMorphedMesh` (`packages/engine/src/morph/morph-bake.ts`) has the same order:
`POSITION`, `UV_0`, then `computeSmoothNormals` appends `NORMAL` last — baked
characters inherit the swap.

## Fix sketch

Insert `NORMAL` before `UV_0` so the final order is `POSITION, NORMAL, UV_0`
(the canonical order the glTF path uses — `ORDERED_ATTRIBUTES` in
`packages/gltf/src/mesh-mapping.ts`). Inserting a `NORMAL` placeholder before
`UV_0` works because `Mesh.insertAttribute` is keyed by id and preserves a key's
position on replace — `computeSmoothNormals` then overwrites the placeholder
in-place without changing order. Apply to both `parseObjBaseMesh` and
`bakeMorphedMesh`; verify the base preview lights correctly and a textured
material samples right.

## Not affected

The RetroHuman preset builds its skinned body mesh in canonical order
(`POSITION, NORMAL, UV_0, JOINTS_0, WEIGHTS_0`, reading the base attributes by
id), so it is correct independent of this bug.
