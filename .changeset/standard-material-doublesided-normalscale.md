---
'@retro-engine/engine': minor
---

feat(engine): StandardMaterial normalScale + doubleSided

Extends the shipped `StandardMaterial` and `pbr.wgsl` with two core PBR controls so models render
correctly without manual shader work.

- **`normalScale`** (default `1`) — normal-map intensity (glTF `normalTexture.scale` semantics).
  `pbr.wgsl` now applies the normal map: it reconstructs a tangent frame from screen-space derivatives
  (no per-vertex tangent attribute required) and scales the sampled tangent-space normal's X/Y by
  `normalScale` before transforming it to world space. With no normal map bound the flat-normal
  fallback is a no-op, so plain materials are unchanged.
- **`doubleSided`** (default `false`) — when `true`, the material's pipeline disables back-face culling
  (cull mode `none` instead of `back`) and the shader flips the shading normal on back faces, so
  single-sided surfaces such as foliage, cards, and glass shade correctly from both sides.

Both fields are additive — no breaking change. `Material` gains an optional `doubleSided(): boolean`
alongside the existing `alphaMode()` / `depthBias()`; single- and double-sided variants of a material
get distinct cached pipelines.
