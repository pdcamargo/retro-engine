---
'@retro-engine/engine': minor
---

feat(engine): Material2d + Mesh2d + ColorMaterial2d — shader-driven 2D geometry through Core2d

Phase 8.7 lands the 2D analogue of Phase 7's `Material` / `Mesh3d` / `MeshMaterial3d<M>` trio, routed through Core2d's existing `ViewPhases2d` plumbing with no depth buffer. Per ADR-0035. `Mesh2d` wraps a `MeshHandle` (same shape as `Mesh3d`); `MeshMaterial2d<M>` pairs it with a `Material2d` implementation; `Material2dPlugin<M>` mirrors `MaterialPlugin<M>` byte-for-byte structure with three forced divergences — queue filters cameras by `view.subGraph === Core2dLabel`, phase routing follows `Material.alphaMode()` (lighting up the previously-empty `AlphaMask2d` slot for `'mask'` mode), and the specialized pipeline carries no depth-stencil dimensions. `ColorMaterial2d` ships as the reference material: a single packed UBO (`color: vec4f` + `alpha_cutoff: f32`) routed through `retro_engine::color_material_2d` WGSL. Bind-group layout matches `Material3d` exactly (`@group(0)` view, `@group(1)` entity transform, `@group(2)` material) so shader authors porting between the two only change vertex math, not slot numbers.

**New public surface:**

- `Material2d` (interface, extends `Material`), `Material2dCtor<M>`, `MaterialPipelineKey2d`, `Material2dPluginOptions`.
- `Mesh2d` (component), `MeshMaterial2d<M>` (component).
- `Materials2d<M>` / `RenderMaterials2d<M>` (type aliases over the 3D registry classes).
- `Material2dPlugin<M>` (per-type subclass synthesis + prepare/queue systems).
- `ColorMaterial2d` (reference material), `ColorMaterial2dPlugin` (idempotent WGSL registration), `COLOR_MATERIAL_2D_DEFAULT_MASK_CUTOFF`, `COLOR_MATERIAL_2D_WGSL`, `alphaBucketKey`.
- `MeshTransformGcPlugin` — singleton GC system for `EntityTransformGpuCache` (idempotently inserted by every material plugin).

**Behaviour changes (non-breaking):**

- `ViewPhases2d.alphaMask` is no longer always-empty — `Material2d` with `alphaMode: { kind: 'mask', cutoff }` writes to this slot via a discard-based fragment path.
- `EntityTransformGpuCache` GC moves to a standalone post-queue system in `RenderSet.PhaseSort`. `gcEntityTransforms`'s signature drops the `liveEntities` argument (now consumes `cache.liveThisFrame`, which `ensureEntityTransform` populates). Single-plugin behaviour is unchanged; multi-plugin coexistence is now race-free.
- Core2d's `Opaque2d` and `AlphaMask2d` phases flip from front-to-back sort to back-to-front, matching `Transparent2d`. Z-axis layering for opaque content (e.g. Hollow Knight–style parallax with `Transform.translation.z`) now renders correctly without forcing `alphaMode: 'blend'` on every layer. All three Core2d phases are painter's-algorithm; the phase distinction is purely about blend state.
