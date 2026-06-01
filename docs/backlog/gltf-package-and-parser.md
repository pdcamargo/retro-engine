# `@retro-engine/gltf` package + in-house parser

- **Created:** 2026-06-01
- **Decision:** ADR-0057

## Context

The glTF loader lives in a new publishable package, `@retro-engine/gltf`, depending on
`@retro-engine/engine`'s public API only. This slice scaffolds the package and builds the in-house
parsing layer: the GLB binary container reader, the glTF JSON schema types, and the accessor decoder —
no runtime parsing dependency. It also defines the validation/error contract.

## Why deferred

The package scaffold + parser is the substrate the mesh/material mapping and instantiation slices build
on; it is sequenced after the `LoadContext` extension (it consumes `ctx.read`) and isolated so the
parsing surface is testable against the Khronos sample models before any engine mapping exists.

## Acceptance

- `packages/gltf` scaffolded (`package.json` `@retro-engine/gltf`, build config, `src/index.ts`),
  depending on `@retro-engine/engine` via its public index only; files split per CLAUDE.md §5.5.
- GLB reader validates the 12-byte header (magic `0x46546C67`, version 2, length) and walks chunks
  (JSON first, space-padded; optional BIN, zero-padded; 4-byte alignment).
- glTF JSON schema types cover buffers/bufferViews/accessors, meshes/primitives, materials, textures/
  images/samplers, nodes/scenes, and `extensionsUsed`/`extensionsRequired`.
- Accessor decoder reads all component types, expands normalized integers to `float32`, honors
  `byteOffset`/`byteStride` (interleaved), and reconstructs sparse accessors.
- Container/bundling variants resolved: external `.bin` + external images (via `ctx.read`), embedded
  `data:` base64, GLB BIN-chunk geometry + images-via-`bufferView`, and mixed. Image MIME detected
  (`image/png`, `image/jpeg` decode; `image/ktx2` recognized, decode deferred).
- `GltfImportError` defined; the loader throws it for bad magic/version, malformed JSON, an unsupported
  required extension, a missing/out-of-bounds buffer/bufferView/accessor, and an unsupported image MIME.
  Errors surface through `AssetLoadFailure`.
- Tests parse representative Khronos sample models (a `.gltf`+`.bin`, a `.glb`, an embedded `data:` URI
  variant) and assert the decoded accessor values; malformed inputs raise `GltfImportError`.
- Lint, typecheck, test, build, bench green; changeset added.
