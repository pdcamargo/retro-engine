---
'@retro-engine/engine': minor
---

feat(engine): expose `composeTransformInto` / `decomposeTransformInto`

`composeTransformInto` (previously engine-private) is now public, and a new `decomposeTransformInto` inverts it — splitting a column-major affine 4×4 matrix into translation, rotation, and per-axis scale. Pure translation/rotation/uniform-scale matrices round-trip exactly; a mirrored basis (negative determinant) negates the X scale so the recovered rotation stays proper. Useful for converting between an entity's local `Transform` and its world `GlobalTransform`, e.g. world-space editor tooling.
