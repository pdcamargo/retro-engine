---
'@retro-engine/gltf': minor
---

feat(gltf): map glTF primitives/materials/images onto engine assets

Adds the data-mapping layer that turns a decoded glTF document into engine assets, building on the parser/decoder. `@retro-engine/gltf` now depends on `@retro-engine/engine` (plus `renderer-core` and `math` for HAL/vector types), consumed through their public entry points.

**Public surface (`@retro-engine/gltf`):**

- `mapGltfAssets(document, buffers, ctx, stores, decoder)` — orchestrator that maps every mesh, material, and image in a document, registering each as a labeled sub-asset (`Mesh{i}/Primitive{j}`, `Material{i}`, `Image{n}`) via `ctx.addLabeledAsset`. Returns `MappedGltfAssets` (`meshes` / `materials` / `images` handle tables) — the input a glTF root asset wires into its scene graph.
- `mapPrimitiveToMesh` — primitive → `Mesh`. Attribute semantics `POSITION/NORMAL/TEXCOORD_0→UV_0/TANGENT/COLOR_0→COLOR`; VEC3 `COLOR_0` expanded to VEC4; indices promoted `u8→u16`, kept `u16`/`u32`; `TEXCOORD_1`/`JOINTS_0`/`WEIGHTS_0` recognised and skipped. No coordinate/winding conversion.
- `mapPrimitiveMode` — primitive draw mode → `PrimitiveTopology`; LINE_LOOP / TRIANGLE_FAN are rejected (no WebGPU topology).
- `mapMaterialToStandardMaterial` — full pbrMetallicRoughness → `StandardMaterial`, including `normalScale`, occlusion strength, emissive (factor + texture), alpha mode + cutoff, and `doubleSided` → cull. glTF factor defaults (`metallic`/`roughness` = 1) applied explicitly. Per-slot color space: base-color/emissive `srgb`; normal/MR/occlusion `linear`.
- `createImageResolver` — resolves texture images to deduped `Image` sub-assets: one handle per unique `(source, color space, sampler)`; a source reused under a divergent sampler or color space is duplicated. `mapSampler` maps glTF wrap/filter enums to `SamplerDescriptor`.
- `ImageDecoder` / `DecodedImagePixels` / `createImageBitmapDecoder` — the injected image-decode port (PNG/JPEG). The package bundles no codec; the default decoder runs in the browser / webview and any environment supplies its own. KTX2 is recognised but its decode stays deferred.

The `Gltf` root asset, node/scene types, `GltfPlugin`, importer registration, and instantiation are a separate, following slice.
