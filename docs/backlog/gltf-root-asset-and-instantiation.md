# `Gltf` root asset + node→entity instantiation

- **Created:** 2026-06-01
- **Decision:** ADR-0057

## Context

The final v1 slice: assemble the decoded parts into the `Gltf` root asset, register the importer, and
build the instantiation reactor that mirrors the node graph as a navigable entity tree with named-node /
bone lookup — the headline requirement.

## Why deferred

Depends on every prior glTF slice (parser, mesh/material mapping) and on the `Name` component and the
`LoadContext` (`addLabeledAsset`). It is the slice that wires glTF into the `App` and the world.

## Acceptance

- `Gltf` root asset holds `scenes`/`namedScenes`/`defaultScene`, `meshes`/`namedMeshes`,
  `materials`/`namedMaterials`, `images`, `nodes` (`GltfNode[]`)/`namedNodes`; `skins`/`animations`
  fields reserved (deferred). `GltfNode`/`GltfScene`/`GltfMesh`/`GltfPrimitive` types defined per ADR-0057.
- `GltfPlugin` registers an `AssetImporter` for `gltf` and `glb` (closing over `Meshes`/`Materials`/
  `Images` for `addLabeledAsset`) and installs the instantiation reactor.
- `GltfSceneRoot { handle, scene? }` component; the reactor system runs in `update`, polls the `Gltf`
  store for readiness (guarded so each root instantiates once), and recursively spawns the node subtree
  via `Commands` `withChildren`/`addChild` — each node entity gets `Transform` from TRS and `Name` from
  the node name; single-primitive mesh nodes get `Mesh3d`+`MeshMaterial3d` directly, multi-primitive
  nodes get one child entity per primitive. `postUpdate` propagation computes `GlobalTransform` the same
  frame.
- `GltfInstanceNodes` recorded on the root: the node-index→`Entity` array (primary) + name→`Entity[]`
  map, with `findByName` (first match, document order) and `findAllByName`; nameless nodes get no `Name`;
  the map is built from reserved entity ids at enqueue time.
- Tests: instantiating a multi-node model produces the expected entity tree with correct parenting and
  transforms; `findByName` returns the entity for a named node/bone; a multi-primitive node yields the
  expected child entities; a duplicate node name is reachable via `findAllByName`.
- Lint, typecheck, test, build, bench green; changeset added.
