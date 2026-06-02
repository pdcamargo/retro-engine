---
'@retro-engine/gltf': minor
---

feat(gltf): Gltf root asset + node→entity instantiation

Completes glTF v1: the importer assembles decoded meshes/materials/images into a `Gltf` root asset and registers itself so `AssetServer.load('model.gltf')` (and `.glb`) works through the standard load-drain path, and a reactor mirrors a scene's node graph as a navigable, named entity tree.

**New public surface (`@retro-engine/gltf`):**

- `Gltf` root asset — `scenes`/`namedScenes`/`defaultScene`, `meshes`/`namedMeshes`, `materials`/`namedMaterials`, `images`, `nodes`/`namedNodes` — plus the `GltfNode` (TRS `Transform`, children, optional mesh), `GltfScene`, `GltfMesh`, and `GltfPrimitive` shapes, and the `Gltfs` store.
- `GltfPlugin({ material, decoder? })` — registers the `gltf` / `glb` importer (closing over the engine's `Meshes` / `Images` stores and the `StandardMaterial` material plugin's store) and installs the instantiation reactor. `decoder` defaults to the browser `createImageBitmap` decoder.
- `GltfSceneRoot { handle, scene? }` — marks an entity for instantiation. The reactor spawns the chosen scene's node graph as a child subtree (each node a `Transform` + a `Name` when named; single-primitive mesh nodes carry `Mesh3d` + `MeshMaterial3d`, multi-primitive nodes become an anchor with one child entity per primitive).
- `GltfInstanceNodes` — recorded on the root after instantiation: the node-index→`Entity` array plus `findByName` / `findAllByName` for named-node / bone lookup.
- `buildGltfRoot`, `createGltfImporter`, `addGltfInstantiation` for advanced/custom wiring.

**Breaking (within the unreleased package):** the raw glTF-JSON schema types `GltfNode` / `GltfScene` / `GltfMesh` / `GltfPrimitive` are no longer re-exported from the package entry — those names now belong to the root-asset types. The JSON document type `GltfDocument` (and its other field types) remain exported.
