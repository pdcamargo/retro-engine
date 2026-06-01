# glTF → `Mesh` and `StandardMaterial` mapping

- **Created:** 2026-06-01
- **Decision:** ADR-0057

## Context

With the parser/decoder in place, this slice maps decoded glTF data onto engine assets: primitives into
`Mesh`, materials into `StandardMaterial`, and images/samplers into `Image`, with correct per-slot
color space and image dedup.

## Why deferred

Depends on `gltf-package-and-parser` (decoded accessors) and
`standard-material-doublesided-normalscale` (the extended material fields it writes). Isolated so the
data-mapping is testable independently of node-graph instantiation.

## Acceptance

- Primitive attributes map: `POSITION→POSITION`, `NORMAL→NORMAL`, `TEXCOORD_0→UV_0`, `TANGENT→TANGENT`,
  `COLOR_0→COLOR`; indices `u16→u16`, `u32→u32`, `u8`→promoted `u16`; provided `TANGENT` used as-is.
  `TEXCOORD_1`/`JOINTS_0`/`WEIGHTS_0` are recognized and skipped (deferred). No coordinate/winding
  conversion.
- Primitive modes map to `renderer-core` `PrimitiveTopology`, capability-gated; triangles tested as the
  primary path.
- Materials map the full pbrMetallicRoughness set onto `StandardMaterial`, including `normalScale`,
  occlusion strength, emissive, alpha mode + cutoff, and `doubleSided` → cull.
- Per-slot color space wired to `Image.colorSpace`: base-color/emissive `srgb`; normal/MR/occlusion
  `linear`. glTF sampler wrap/filter mapped to the per-`Image` `SamplerDescriptor`; sampler divergence
  handled by duplicating the `Image`.
- Image dedup: one `Handle<Image>` per unique source (URI or `bufferView`) within a load.
- All sub-assets registered via `ctx.addLabeledAsset` (labels `Mesh{i}`, `Material{i}`, `Image{i}`/
  `…/Primitive{j}`).
- Tests assert a multi-material model yields the expected meshes/materials/images with correct color
  spaces, that a shared image is deduped to one handle, and that double-sided/normal-scale fields carry
  through.
- Lint, typecheck, test, build, bench green; changeset added.
