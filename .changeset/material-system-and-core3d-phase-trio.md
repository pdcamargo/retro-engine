---
'@retro-engine/engine': minor
---

feat(engine): material system, Core3d phase trio, per-camera depth automation

Phase 7 lands the material slice. The 436-LOC playground primitives showcase shrinks to 175 LOC of bundle-spawning — the Phase 7 boundary check from ADR-0028. Per ADR-0027, ADR-0028, and consuming ADR-0029's HAL extensions.

**Material system (ADR-0028):**

- `Material` interface, `MaterialPipelineKey` specialization key, `ShaderRef` / `ShaderRefs` for shader references.
- `MaterialPlugin<M>` engine plugin: synthesises per-type subclasses of `Materials<M>` / `RenderMaterials<M>` / `MeshMaterial3d<M>` so the class-keyed ECS / resource store disambiguates material types at runtime despite TypeScript's erased generics. Registers extract / prepare / queue systems.
- `Materials<M>` / `MaterialHandle<M>` / `RenderMaterials<M>` registries (mirrors `Meshes` / `MeshHandle` / `RenderMeshes`).
- `Mesh3d` + `MeshMaterial3d<M>` components — spawn a drawable 3D mesh with `cmd.spawn(new Mesh3d(mh), new plugin.MeshMaterial3d(handle))`.
- `EntityTransformGpuCache` resource: per-entity `@group(1)` uniform buffer + bind group, holding `model` and `inverse_transpose_model` matrices.
- `ExtendedMaterial<Base, Extension>` wrapper with `forExtendedMaterial(Base, Extension)` factory: runtime schema concat with binding-offset shift, extension-shader overrides base, composed `specialize()`.

**Bind-group schema (ADR-0027):**

- `BindGroupSchema<M>` + `BindGroupEntry<M>` discriminated union (uniform / texture / sampler / storage buffer / storage texture).
- `MaterialSchema(ClassRef, [...])` helper for compile-time refactor safety — renaming a material field surfaces a TS error on the schema entry. Raw object literals do not get this.
- `schemaToBindGroupLayout`, `prepareBindGroup` walker: schema → `BindGroupLayout`; instance fields → uniform packing with WGSL `std140` alignment + `BindGroup` assembly.

**Core3d phase trio:**

- `Opaque3d` + `AlphaMask3d` + `Transparent3d` phase items in `ViewPhases3d`. Per-camera lists pushed by every `MaterialPlugin<M>`'s queue system; sorted front-to-back (opaque/mask) or back-to-front (transparent) by camera-space depth.
- `OpaquePass3dNode`: opens color+depth pass (clear depth), binds view at `@group(0)`, draws opaque then mask items.
- `TransparentPass3dNode`: opens second pass (load color+depth, depth-write disabled), binds view, draws transparent items.
- `buildCore3dSubGraph` rewritten to `OpaquePass3dNode → TransparentPass3dNode`. `MainPassNode` stays in `Core2d`; Phase 8 will displace it there with the 2D phase trio.

**Per-camera depth automation:**

- `CameraDepthTarget` union: `'auto' | 'none' | { kind: 'manual', view, format }`. `Camera3d()` defaults to `'auto'`; `Camera2d()` defaults to `'none'`.
- `ViewDepthCache` resource: per-camera depth-texture allocation, resizes on color-target change, garbage-collects entries for cameras absent from the current frame.

**`@group(0)` view auto-bind:**

- Every Core3d phase node + `MainPassNode` unconditionally `pass.setBindGroup(0, view.viewBindGroup)` right after `beginRenderPass`. Material pipelines lay out `@group(0) @binding(0)` for view data; consumers that re-bind `@group(0)` to their own data are unsupported (the contract is documented in `Material`'s TSDoc).

**`PipelineCache.descriptorKey` expansion:**

- Bug-fix prerequisite for materials: the descriptor key now includes depth-stencil state, cull mode, front face, per-target blend / write mask, and vertex buffer layout. Two materials varying any of these no longer silent-collide on the same cache slot.

**`calculateBoundsSystem` body:**

- ADR-0021's reserved slot is filled. Iterates `Mesh3d` entities without `NoFrustumCulling`, looks up the mesh asset, computes the AABB, writes the `Aabb` component. `NoFrustumCulling` doubles as the "I manage bounds myself" escape hatch.

**Built-in materials:**

- `UnlitMaterial` + `UnlitMaterialPlugin` — `color * texture(uv)` flat shading, the minimal Bevy parity.
- `StandardMaterial` + `StandardMaterialPlugin` — metallic-roughness PBR (Lambert + GGX + Schlick) with all glTF texture slots. One hardcoded directional light + constant ambient as the Phase 7 placeholder; Phase 10's lighting and Phase 10.7's IBL replace the placeholders additively.

**Playground refactor:**

- `apps/playground/src/primitives-showcase-plugin.ts`: 436 LOC → 175 LOC, the ADR-0028 boundary check. No custom shader, no custom pipeline layout, no custom render-graph sub-graph, no manual depth texture. Spawn loop building `(Mesh3d, MeshMaterial3d<UnlitMaterial>, Transform)` bundles + a one-system rotator.
