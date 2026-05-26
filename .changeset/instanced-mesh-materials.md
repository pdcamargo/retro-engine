---
'@retro-engine/engine': minor
---

feat(engine): GPU-instanced 3D / 2D mesh-material rendering

Mesh-material entities are now drawn with GPU instancing instead of one draw
call per entity. Renderables are batched by `(camera, alpha bucket, mesh,
material)`; each batch packs its per-instance transforms into one shared vertex
buffer (`stepMode: 'instance'`, one `writeBuffer` per material type per frame)
and emits a single instanced `drawIndexed`. N copies of a mesh collapse from N
draws + N buffer uploads to O(batches). Opaque / alpha-mask 3D batches group
freely (the depth buffer resolves order); transparent 3D and all 2D buckets stay
depth-ordered and merge only adjacent same-key runs. Sealed in ADR-0038.

This removes the per-entity `@group(1)` transform uniform and
`EntityTransformGpuCache`; the per-entity draw-closure GC churn goes with it.

**Breaking — custom material WGSL only.** The bind-group layout is renumbered:
material resources move from `@group(2)` to `@group(1)` (view stays `@group(0)`).
A material that reuses a built-in vertex shader only needs that `@group(2)` →
`@group(1)` change. A material with a fully custom vertex shader must also drop
the old `EntityTransform` uniform and read the model matrix from per-instance
vertex attributes at `@location(8..11)` (plus the inverse-transpose at
`@location(12..15)` for lit shaders). TypeScript material definitions and entity
spawning are unchanged. All built-in materials (`UnlitMaterial`,
`StandardMaterial`, `ColorMaterial2d`) are migrated.

Removed exports: `EntityTransformGpuCache`, `ensureEntityTransform`,
`gcEntityTransforms`, `ENTITY_TRANSFORM_BUFFER_SIZE`, `MeshTransformGcPlugin`.
