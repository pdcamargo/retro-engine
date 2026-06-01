# @retro-engine/gltf

In-house glTF 2.0 / GLB import for Retro Engine: a hand-rolled GLB binary-container reader, glTF JSON schema types, and an accessor decoder (all component types, normalized-integer expansion, interleaved `byteStride`, sparse reconstruction) — with no runtime parsing dependency.

```sh
bun add @retro-engine/gltf
```

See [ADR-0057](../../docs/adr/ADR-0057-gltf-import.md). The mesh/material mapping, the `Gltf` root asset, and the `GltfPlugin` instantiation reactor build on this parsing layer.
