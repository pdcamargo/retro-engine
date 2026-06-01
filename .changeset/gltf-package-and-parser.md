---
'@retro-engine/gltf': minor
---

feat(gltf): new `@retro-engine/gltf` package — in-house glTF 2.0 / GLB parser

Stands up the publishable `@retro-engine/gltf` leaf package and its from-scratch parsing layer, with no runtime parsing dependency. This is the foundation the mesh/material mapping and scene-instantiation layers build on.

**New public surface:**

- `parseGltf(bytes)` — parse a `.glb` binary container or a loose `.gltf` JSON document into a `ParsedGltf` (`{ document, bin? }`), validating the asset version and the required-extension contract.
- `readGlb(bytes)` / `isGlb(bytes)` / `GlbContainer` — GLB container reader: 12-byte header validation (magic, version 2, length) and chunk walking (JSON first, optional BIN), with clear errors.
- `decodeAccessor(document, buffers, index)` → `DecodedAccessor` — decodes every component type into a flat typed array, expands normalized integers to `float32`, honors `byteOffset`/`byteStride` (interleaved layouts), and reconstructs sparse accessors.
- `resolveBuffers(document, bin, read)` / `sliceBufferView(...)` / `SiblingReader` — resolve every buffer (external sibling via the injected reader, embedded `data:` URI, or GLB BIN chunk) and slice bufferViews, bounds-checked.
- `detectImageMime(bytes, hint?)` → `SupportedImageMime` — classify an image by `mimeType`, URI extension, or magic bytes (`image/png`, `image/jpeg` for v1; `image/ktx2` recognized).
- `GltfImportError` / `GltfErrorCode` — the validation/error contract: bad GLB magic/version, malformed JSON, unsupported required extension, missing/out-of-bounds buffer/bufferView/accessor, and unsupported image MIME.
- The glTF 2.0 JSON schema types (`GltfDocument`, `GltfAccessor`, `GltfMesh`, `GltfMaterial`, …) for the v1 subset.

Mesh/material mapping, the `Gltf` root asset, and the `GltfPlugin` instantiation reactor are not included here.
