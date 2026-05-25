# ADR-0028: Material system, `Mesh3d` / `MeshMaterial3d<M>`, Core3d phase trio, per-camera depth automation

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

Renderer-roadmap Phase 7 ships the materials slice. ADR-0024 / ADR-0025 closed Phase 6's data layer — `Mesh`, `RenderMesh`, `MeshAllocator`, `RenderMeshes` are in tree, the playground showcase plugin proves the draw path works end-to-end. ADR-0021 reserved the `calculateBoundsSystem` slot in `VisibilityPlugin`'s schedule — Phase 7 fills it. ADR-0022 shipped `ShaderRegistry`, `PipelineCache`, and `SpecializedRenderPipelines<Key>` — Phase 7 is the first consumer of `SpecializedRenderPipelines<MaterialPipelineKey>`. ADR-0023's `MainPassNode` shim was explicitly scoped as "Phase 10 expands `Core3d` with depth + lighting nodes" — Phase 7 elects to displace the shim in `Core3d` now rather than wait, because the alpha-blend pass needs the phase trio shape.

ADR-0027 settles the bind-group schema declaration: class-static `bindGroup` + `MaterialSchema(ClassRef, [...])` helper. ADR-0029 closes the HAL gaps for stencil + depth-bias + blend that materials need.

The 436-LOC `apps/playground/src/primitives-showcase-plugin.ts` is the consumer this ADR ships for. Today it manages its own depth texture, its own bind-group layout, its own pipeline-layout, its own uniform packing, and a custom render-graph sub-graph because there was no material system to lean on. Phase 7's deliverable boundary is "the showcase shrinks to ~150 LOC of spawning `Mesh3d` + `MeshMaterial3d<StandardMaterial>` bundles in a loop." If it doesn't, the material API is wrong.

Out of scope for this ADR (each documented in §"Not yet done" with its trigger):

- **IBL** (image-based lighting for `StandardMaterial`) — Phase 10.7.
- **Shadow maps** — Phase 10.4. The depth-bias HAL surface (ADR-0029) is ready; the actual prepass + shadow sampling lands with the lighting ADR.
- **Deferred rendering** — Phase 10.x. The `OpaqueRendererMethod` enum (`Forward | Deferred | Auto` in Bevy) is intentionally not in this ADR. Shipping a one-arm enum is debt; the field lands when the GBuffer + prepass pipeline does.
- **2D phase trio inside `Core2d`** (`Opaque2d` / `AlphaMask2d` / `Transparent2d`) — Phase 8. `MainPassNode` stays as the `Core2d` shim until Phase 8 displaces it.
- **`MaterialPlugin.forSpecialized<M>(...)`** — extension for materials whose pipelines vary per-instance (per-light, per-shadow-cascade). Lands when a real consumer needs it.
- **Cross-material pooling** of per-camera depth textures — premature optimization. Each camera allocates its own depth texture; two cameras at the same resolution get two textures.
- **Per-camera `ViewVisibility`** — ADR-0023 deferred this; Phase 7 stays on the aggregate boolean and revisits when a multi-pass consumer suffers from it.

## Decision

1. **Phase 7 lives in `packages/engine/src/material/`.** One concern per file (CLAUDE.md §5.5), submodule re-exports through `index.ts`, engine package root re-exports the submodule's names alongside the rest. Mirrors the established `mesh/`, `camera/`, `visibility/`, `shader/`, `render-graph/` shape.

2. **`Material` is an interface, not an abstract class.** Instance methods on the interface are all optional with documented defaults:

   ```ts
   export type AlphaMode = 'opaque' | { kind: 'mask'; cutoff: number } | 'blend';

   export interface Material {
     alphaMode?(): AlphaMode;   // default 'opaque'
     depthBias?(): number;      // default 0
   }
   ```

   The static surface (class-level metadata — not part of the TS interface, contracted by convention and validated at `MaterialPlugin<M>.build()` time): `static bindGroup: BindGroupSchema<M>`, `static vertexShader?(): ShaderRef`, `static fragmentShader?(): ShaderRef`, `static specialize?(descriptor, vertexLayout, key)`. Composition over inheritance (CLAUDE.md §5.1) — `StandardMaterial` is `implements Material`, not `extends Material`. `MaterialPlugin<M>` reflects on the class's statics at build time; it does not call into a base class.

3. **`Materials<M>` mirrors `Meshes`.** Main-world resource, one per material type. `MaterialHandle<M>` is a branded `number & { readonly __materialHandle: unique symbol; readonly __material: M }` — the phantom `M` parameter distinguishes `MaterialHandle<StandardMaterial>` from `MaterialHandle<UnlitMaterial>` at the type level with no runtime cost. API mirrors `Meshes`: `add`, `get`, `mutate`, `remove`, `drainPendingChanges`. Pre-asset-system shape; same migration TSDoc as `MeshHandle`. `RenderMaterials<M>` is the render-world mirror, populated by `MaterialPlugin<M>`'s prepare system.

4. **`Mesh3d` and `MeshMaterial3d<M>` are ECS components.** `Mesh3d(meshHandle)` carries a `MeshHandle`. `MeshMaterial3d<M>(materialHandle)` carries a `MaterialHandle<M>`. The pair is the spawn-time API: `cmd.spawn(new Mesh3d(cube), new MeshMaterial3d(redMat), new GlobalTransform(...))`. `Mesh3d.requires = [GlobalTransform, InheritedVisibility, ViewVisibility]`. `MeshMaterial3d<M>` has no `requires` — it pairs with `Mesh3d`, and a `MeshMaterial3d` without a `Mesh3d` is a queryable no-op rather than an error.

5. **`MaterialPlugin<M>` registers the per-type plumbing.** One plugin instance per material type:

   ```ts
   app.addPlugin(new MaterialPlugin<StandardMaterial>(StandardMaterial));
   ```

   On `build`:
   - Inserts `Materials<M>` (main world), `RenderMaterials<M>` (render world).
   - Walks `M.bindGroup` via `schemaToBindGroupLayout` (ADR-0027) → caches the `BindGroupLayout` on a per-type-singleton state struct.
   - Caches the `M.fragmentShader()` / `M.vertexShader()` results — both resolved through `ShaderRegistry` via the `ShaderRef` indirection.
   - Allocates a `SpecializedRenderPipelines<MaterialPipelineKey>` instance keyed by the layout — Phase 7's first consumer of ADR-0022 §"Specialization."
   - Registers six systems across the established `RenderSet` stages:

   | Stage | System | Responsibility |
   |---|---|---|
   | Extract | `extractMaterialAssets<M>` | Drain `Materials<M>.drainPendingChanges` → render-side queue; mirrors `MeshPlugin`'s extract system one-for-one. |
   | Extract | `extractMeshMaterial3d<M>` | For each entity with `Mesh3d + MeshMaterial3d<M> + GlobalTransform + ViewVisibility.visible === true && InheritedVisibility.visible === true`, spawn an `ExtractedRenderable<M>` render-world entity carrying `{ sourceEntity, meshHandle, materialHandle, transform: Mat4 (deep copy), alphaMode, depthBias }`. |
   | Prepare | `prepareMaterials<M>` | For each row in `RenderMaterials<M>` (or each `Added` / `Modified` event from extract), run `prepareBindGroup` (ADR-0027): pack uniforms into a shared scratch `ArrayBuffer`, `renderer.writeBuffer`, resolve texture / sampler handles, assemble the `BindGroup`. Result cached per `MaterialHandle<M>`. |
   | Queue | `queueMaterials3d<M>` | Iterate `ExtractedRenderable<M>` × `SortedCameras.views`; per (camera, renderable) compute the camera-space depth of the entity's transform origin, select the phase (`Opaque3d` / `AlphaMask3d` / `Transparent3d`) from `alphaMode`, push a phase item carrying `{ entity, pipelineKey, materialHandle, meshHandle, viewDepth }`. |
   | Render | `drawMaterials3d<M>` | Inside each Core3d phase node: per phase item, fetch the specialized pipeline via `SpecializedRenderPipelines<MaterialPipelineKey>.get(key)`, `pass.setPipeline`, `pass.setBindGroup(2, materialBindGroup)`, `pass.setBindGroup(1, perEntityBindGroup)` (transforms — see §10), look up the mesh slice from `MeshAllocator.vertexSlice/indexSlice`, bind vertex/index buffers, draw. |

   Phase items (`Opaque3d`, `AlphaMask3d`, `Transparent3d`) are owned by the Core3d submodule and live in App resources keyed by `(cameraEntity, phaseKind)`. Sorted in `RenderSet.PhaseSort` by an engine-owned sorter system (front-to-back for opaque + mask, back-to-front for transparent). The phase-item type ships in `packages/engine/src/render-graph/phase-3d.ts`.

   `MaterialPlugin<M>` is *not* unique — instantiating it twice for the same `M` is the same data twice, and the plugin defensively no-ops on duplicate insertion of its resources, but the system registrations would double-fire. The TSDoc forbids two calls; the plugin throws when it detects an existing `Materials<M>` for the same type tag.

6. **`MaterialPipelineKey` is the specialization input.** Fields:

   ```ts
   interface MaterialPipelineKey {
     msaaSamples: 1 | 4;
     hdr: boolean;
     vertexLayoutDigest: string;    // FNV-1a over MeshVertexBufferLayoutRef shape
     alphaMode: AlphaMode;
   }
   ```

   The `specialize()` flow:
   - `MaterialPlugin<M>`'s queue system computes the key per phase item from `(Camera.msaaSamples, Camera.hdr, mesh.layout, material.alphaMode)`.
   - The plugin's `SpecializedRenderPipelines<MaterialPipelineKey>.get(key)` calls a closure that builds a base `RenderPipelineDescriptor` (vertex/fragment modules resolved through `ShaderRegistry`, vertex buffers from the layout, color targets from the camera's render target format + HDR, depth-stencil from the key's `alphaMode` and Core3d's depth format, blend / write-mask from `alphaMode`, `cullMode: 'back'` by default).
   - The plugin then calls `M.specialize?.(descriptor, layout, key)` so the material can override or extend before the descriptor reaches `PipelineCache.getOrCreateRenderPipeline`.
   - `Opaque3d` and `AlphaMask3d` produce pipelines with `depthWriteEnabled: true`, `blend: undefined` (opaque writes). `AlphaMask3d` additionally adds `#define ALPHA_DISCARD` + the `alphaCutoff` uniform.
   - `Transparent3d` produces pipelines with `depthWriteEnabled: false`, blend set to canonical premultiplied-alpha (`color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }`, `alpha` matching).

7. **`PipelineCache.descriptorKey` expands.** ADR-0022's key currently digests layout + shader@entry + color-target formats + topology. With ADR-0029's HAL surface live, two materials varying depth-stencil state, cull mode, front face, blend state, write mask, or multisample sample count would silent-collide on the same cache slot. The fix is in `packages/engine/src/shader/pipeline-cache.ts` — `descriptorKey` grows additional segments for depth-stencil (format + compare + write-enabled + bias triple + stencil read/write mask + per-face compare+ops), `primitive.cullMode`, `primitive.frontFace`, per-target `blend` (operation + factors per channel-group) + `writeMask`, and `multisample.count` (when ADR-0029 ships the field) — the key remains a single string for FNV-1a hashing. Regression tests under `pipeline-cache.test.ts` cover three distinct cases: different depth formats → two pipelines, different blend states → two pipelines, different cull modes → two pipelines. The cache-key expansion is bundled into this ADR's implementation rather than its own ADR because it's a load-bearing bug fix forced by materials being the first consumer to vary these fields.

8. **`Camera.depthTarget` is the per-camera depth declaration.** New field on `Camera`:

   ```ts
   export type CameraDepthTarget =
     | 'auto'                                                              // engine allocates depth32float
     | 'none'                                                              // no depth attachment
     | { kind: 'manual'; view: TextureView; format: TextureFormat };       // user-managed

   class Camera {
     // ...existing fields...
     depthTarget: CameraDepthTarget;
   }
   ```

   Defaults: `Camera2d()` factory sets `depthTarget: 'none'` (2D doesn't need depth). `Camera3d()` factory sets `depthTarget: 'auto'`. The user can override either.

9. **`ViewDepthCache` owns per-camera depth textures.** New render-world resource:

   ```ts
   class ViewDepthCache {
     perCamera: Map<Entity /* sourceEntity */, {
       texture: Texture; view: TextureView;
       width: number; height: number; format: TextureFormat;
     }>;
   }
   ```

   A new `prepareViewDepthTextures` system runs in `RenderSet.Prepare`, sibling to `prepareCameras` in `camera-plugin.ts`. For each active `Camera3d` (or any camera with `depthTarget !== 'none'`): if no entry exists or the color target's size changed, destroy the old texture (when present) and allocate a fresh `depth32float` (or `depth24plus-stencil8` when the user opts in) texture matching the resolved color target's `width`/`height`. Manual targets pass through. Entries whose `sourceEntity` is absent from this frame's `SortedCameras.views` are garbage-collected at the end of the prepare pass.

   `CameraView` (the per-frame extracted view struct) gains a `depthView?: TextureView` field, populated by the prepare system. Phase nodes read it without touching the cache directly.

   No cross-camera pooling. Pooling is a future-Phase optimization with non-trivial ordering hazards (preserved-depth between cameras becomes a footgun); skipping it now is cheap.

10. **Core3d phase trio replaces `MainPassNode` inside `Core3d`.** Three new view nodes:

    - `OpaquePass3dNode` — opens one render pass with the camera's color target + `depthView` (`depthLoadOp: 'clear'`, depthClearValue: 1.0, `depthStoreOp: 'store'`). Binds `@group(0)` to the view bind group. Iterates the camera's `Opaque3d` phase items (sorted front-to-back) and then its `AlphaMask3d` items (sorted front-to-back, same pass — both write depth, the alpha-mask shader discards rather than blends). Ends the pass.
    - `TransparentPass3dNode` — opens a second render pass with the same color target (`loadOp: 'load'`, `storeOp: 'store'`) and the same depth view (`depthLoadOp: 'load'`, `depthStoreOp: 'discard'`, pipelines have `depthWriteEnabled: false`). Binds `@group(0)`. Iterates the camera's `Transparent3d` items (sorted back-to-front). Ends the pass.

    `buildCore3dSubGraph` is rewritten: `OpaquePass3dNode → TransparentPass3dNode`. The Phase-10 "depth + lighting + post" expansion that ADR-0023 promised happens inside this trio — prepass before `OpaquePass3dNode`, lighting nodes between, post-processing after `TransparentPass3dNode`. The trio shape is the template.

    `MainPassNode` stays in tree; `Core2d` continues to use it. Its TSDoc updates to say "Core2d only — `Core3d` uses the Phase 7 trio." Phase 8 will displace it in `Core2d` with the 2D phase trio.

    Per-entity transform data flows through a `@group(1)` bind group built by a fixed-shape engine system (one UBO of `Mat4` model + `Mat4` normal). The view bind group occupies `@group(0)`. Material bind group occupies `@group(2)`. `@group(3)` is reserved for future material extensions (skinning, instance data).

11. **`@group(0)` view auto-bind is enforced engine-side.** Each Core3d phase node, immediately after `beginRenderPass` and before invoking draw systems, unconditionally calls `pass.setBindGroup(0, view.viewBindGroup)`. Same in `MainPassNode` (Core2d shim). The contract is documented in the `Material` interface TSDoc: *the engine sets `@group(0)` on every camera pass; user material pipelines that need `@group(0)` for their own data are unsupported.* The `retro_engine::view` shader module (registered by `CameraPlugin` per ADR-0022 §8) is the canonical view-uniform source; material shaders `#import retro_engine::view` and reference `view::ViewUniform` rather than redeclaring the struct.

    The playground triangle (`apps/playground/src/triangle-plugin.ts`) was the only in-tree consumer of `@group(0)` for non-view data; it refactors to `UnlitMaterial` and its color uniform lives in the material's bind group at `@group(2)`. Backlog item `docs/backlog/view-bind-group-zero-convention.md` is deleted after the user confirms the convention is live.

12. **`calculateBoundsSystem` gains its body.** The slot ADR-0021 reserved and ADR-0024 anchored at the head of `VisibilityPlugin`'s `'postUpdate'` order. The body:

    - Query: entities with `Mesh3d` filtered by `Added<Mesh3d> | Changed<Mesh3d>` and without `NoFrustumCulling`.
    - For each, look up `Mesh` from main-world `Meshes.get(handle)`; if absent, skip.
    - Call `mesh.computeAabb()` → insert or overwrite the entity's `Aabb` component (`world.insertOrSet`).

    `NoFrustumCulling` (already a Phase 6 component) doubles as the "I manage bounds myself" escape hatch — entities carrying it are skipped by both `calculateBoundsSystem` and `checkVisibilitySystem`'s frustum test. Avoids inventing a `ManagedAabb` marker that would duplicate the existing semantics.

13. **`ExtendedMaterial<Base, Extension>` is a wrapper class.** `class ExtendedMaterial<B extends Material, E extends Material> implements Material`; constructor takes `(base, extension)`; `alphaMode()` / `depthBias()` delegate to extension first, then base, then defaults. Statics are *not* on the wrapper — the user registers via `MaterialPlugin.forExtended(Base, Extension)`, which:
    - Reads `Base.bindGroup` and `Extension.bindGroup`.
    - Builds a merged schema: `Base.bindGroup ++ Extension.bindGroup.map(e => ({ ...e, binding: e.binding + offset }))` where `offset = max(Base.bindGroup.bindings) + 1`.
    - Throws (dev-mode) if any shifted binding collides with a base binding.
    - Picks shaders: `Extension.fragmentShader?.() ?? Base.fragmentShader?.()`, same for vertex.
    - Composes `specialize`: base's runs first, then extension's, both mutating the same descriptor.
    - Registers `Materials<ExtendedMaterial<Base, Extension>>` with the merged shape.

    Extension WGSL shaders `#import` the base's shader module by its registered name (`retro_engine::pbr` for `StandardMaterial`) and call into it as a function. This is how `StandardMaterial` + a cel-shade extension compose: the extension's fragment shader imports the base PBR, calls `pbr::compute_pbr(input)`, and post-processes the result.

14. **`StandardMaterial` ships metallic-roughness PBR minus IBL.** Fields: `baseColor: Vec4` (default white), optional `baseColorTexture`, `metallic: number` (default 0), `roughness: number` (default 0.5), optional `metallicRoughnessTexture`, optional `normalMapTexture`, `emissive: Vec3` (default zero), optional `emissiveTexture`, optional `occlusionTexture`, `alphaMode_: AlphaMode` (default `'opaque'`), `depthBias_: number` (default 0). Method form `alphaMode()` / `depthBias()` is required by the `Material` interface; the trailing-underscore field is the user-settable storage.

    WGSL ships under `packages/engine/src/material/pbr.wgsl` and registers as the shader-module name `retro_engine::pbr` (with `retro_engine::pbr_vertex` / `retro_engine::pbr_fragment` as the entry-point references). The shader expects:
    - `@group(0)` view uniform (`retro_engine::view`).
    - `@group(1)` per-entity model uniforms.
    - `@group(2)` material bind group (the schema-built layout: 5 textures + 5 samplers + 1 packed uniform).
    - Vertex attributes: `POSITION`, `NORMAL`, `UV_0`, `TANGENT` (TANGENT optional — falls back to derivative-based per-fragment tangent space when absent and `normalMapTexture` is set).

    IBL is the Phase 10.7 additive load — when it lands, `StandardMaterial` gains an optional environment-map handle and the WGSL gains an `#ifdef ENABLE_IBL` branch driven by a specialization key. No breaking changes are required to ship IBL later.

15. **`UnlitMaterial` is the minimal Bevy parity.** Fields: `color: Vec4`, optional `colorTexture`, `alphaMode_: AlphaMode`. Shaders under `unlit.wgsl`, registered as `retro_engine::unlit`. No lighting; outputs `color * texture` at the fragment.

16. **Blend ships now as a full phase trio.** The user explicitly opted in (the Phase 7 plan): `alphaMode === 'blend'` produces a working `Transparent3d` phase item, sorted back-to-front, drawn with `depthWriteEnabled: false`, blended onto whatever the opaque pass produced. No "transparent is rejected at validation time" half-state — it works end-to-end.

17. **`OpaqueRendererMethod` is intentionally absent.** Bevy's `Forward | Deferred | Auto` enum has no Phase 7 backing — deferred rendering, GBuffer types, and the prepass pipeline are all Phase 10 work. Shipping a one-arm enum (only `Forward` works) forces every material declaration to carry `opaqueRenderMethod: 'forward'` for no benefit. The enum lands with the Phase 10 deferred-rendering ADR alongside the code that actually consumes it.

Composition-only. The material system extends the engine via plugin registration. No abstract `Material` class, no `BasePass3dNode`, no `BaseRenderable`. The HAL (ADR-0029) is consumed through the established `renderer-core` types; the render graph (ADR-0023) is consumed by registering nodes against the existing `RenderSubGraph` shape. `Mesh3d`, `MeshMaterial3d<M>`, `Material` instances are plain TypeScript classes with no inheritance.

## Consequences

**Easier:**

- The 436-LOC `primitives-showcase-plugin.ts` refactors to ~150 LOC. No bind-group-layout construction, no pipeline-layout construction, no uniform packing, no depth-texture management, no custom render-graph sub-graph. Spawn `Mesh3d + MeshMaterial3d` in a loop; the engine does the rest. This is the brief's load-bearing claim and the boundary check for "the material system is correctly scoped."
- glTF (Phase 11) imports `Mesh` (Phase 6 surface) + `StandardMaterial` (this ADR) and produces a scene from one bundle factory. No additional plumbing in the glTF importer.
- Sprites (Phase 8) consume `MaterialPlugin<M>` for 2D sprite materials. The 2D phase trio Phase 8 ships is the Core3d trio's mirror — same shape, same sort key, same draw-system structure. ADR-0023's "Phase 8 displaces `MainPassNode` in `Core2d`" promise is realized.
- Custom materials in user code: declare a class implementing `Material`, write the `static bindGroup = MaterialSchema(Self, [...])`, supply a WGSL shader, register `MaterialPlugin<MyMaterial>`. No engine internals required.
- Custom material extensions: `class MyExtension implements Material { ... }`, register `MaterialPlugin.forExtended(StandardMaterial, MyExtension)`. The extension's WGSL `#import retro_engine::pbr` and composes the base's PBR with its own post-processing in fragment.
- Per-camera depth textures are engine-owned and lifecycle-managed. Spawning a `Camera3d` Just Works; the engine allocates, resizes, and frees the depth texture invisibly.
- The `@group(0)` view-bind-group convention is enforced — no consumer can accidentally bind their own data to `@group(0)` without WebGPU complaining at pipeline-creation time. Material authors learn the convention by reading `Material`'s TSDoc once and never thinking about view-binding again.
- `Mesh3d`'s `calculateBoundsSystem` body fills the slot that's been reserved since ADR-0021. Frustum culling Just Works for every `Mesh3d` entity with no explicit AABB.

**Harder / accepted trade-offs:**

- **`MaterialPlugin<M>` is registered per material type.** Three material types means three plugin instances. Acceptable — Bevy's pattern is identical. A `MaterialPluginGroup` convenience that registers `StandardMaterial` + `UnlitMaterial` + `ExtendedMaterial`-prepacks could land later; today's three lines of `app.addPlugin(...)` are the bottleneck for nobody.
- **Phase items live in App resources, not in the render-world ECS.** A `Opaque3d` phase item is just data, not an entity. The render world's archetype storage is well-suited to "one row per renderable per camera"; phase items would round-trip through extract-then-queue-then-render with no benefit. The choice mirrors Bevy's `PhaseItem` shape — the resource carries `Map<cameraEntity, Phase>` and each `Phase` is a flat array sorted in PhaseSort. When the first consumer of cross-system phase-item state appears, this can migrate; today's flat-array shape is the right one.
- **Core3d's two-pass shape (opaque + transparent) is fixed in Phase 7.** A material that wants to bypass both — a custom outline pass, an overlay UI pass — has to register its own render-graph node. The plugin-extension surface is the established `RenderSubGraph.addNode` / `RenderSubGraph.addEdge` from ADR-0023; nothing in this ADR locks plugin authors out. Phase 7 simply doesn't anticipate every possible custom pass; it ships the two that 95% of consumers want.
- **`ExtendedMaterial`'s binding-offset shift is automatic, not configurable.** A `Base` with bindings 0..4 and an `Extension` with bindings 0..2 produces a merged layout with bindings 0..4 (base) and 5..7 (extension). The extension's WGSL `@binding(N)` numbers must match the *post-shift* layout — `@group(2) @binding(5) var<uniform> ext` for the example above. Documented in `MaterialPlugin.forExtended`'s TSDoc; a dev-mode runtime check compares each `BindGroupLayoutEntry` against the parsed WGSL declaration (when the preprocessor grows that surface) — until then, layout mismatches surface at pipeline-creation time as WebGPU validation errors with a helpful "extension binding N collided / mismatched" wrapper.
- **`PipelineCache.descriptorKey` becomes considerably longer.** The string-concat key grows from ~five segments to ~twenty. FNV-1a is still O(string length); 20 segments is a few dozen bytes per descriptor, irrelevant in absolute terms. The cache hit rate stays at "one pipeline per distinct descriptor" which is correct.
- **Transparent pass writes to the same depth view that opaque cleared.** Transparent items participate in depth-test (a transparent object behind an opaque wall is occluded) but don't write depth (a transparent object in front of another transparent object doesn't occlude itself when drawn back-to-front). This is correct; documented.
- **Per-camera depth allocation is per-camera.** Two cameras at 1920×1080 use 16 MB of depth32float each rather than sharing one 8 MB texture. Acceptable for v1; pooling lands when a multi-camera profiler call says so.
- **Phase 8 inherits the Core3d trio shape.** A future Phase-8 maintainer who wants to ship a different sprite-pass shape (e.g., one-pass batched without phase sort) has the option of registering a different `RenderSubGraph` for `Core2d` but inherits the precedent established here. Acceptable — the precedent is the right one for the 95% case.

## Not yet done

- **`OpaqueRendererMethod` enum** (`Forward | Deferred | Auto`) — Phase 10 deferred-rendering ADR.
- **IBL** for `StandardMaterial` — Phase 10.7.
- **Shadow maps** — Phase 10.4 (the depth-bias HAL surface is ready via ADR-0029).
- **Prepass / motion vectors / TAA** — Phase 12.
- **Core2d phase trio** — Phase 8.
- **Per-camera `ViewVisibility`** — when a multi-pass consumer suffers from aggregate-boolean.
- **`MaterialPlugin.forSpecialized<M>`** for per-instance pipeline variants.
- **Depth-texture pooling across cameras** — when a measured perf consumer asks.
- **WGSL parser-driven validation of extension binding numbers** — lands with the WGSL parser ADR.

## Implementation

- `packages/engine/src/material/material.ts` — `Material` interface, `AlphaMode`, `MaterialPipelineKey`, `ShaderRef`.
- `packages/engine/src/material/bind-group-schema.ts` — `BindGroupSchema<M>`, `MaterialSchema(ClassRef, [...])` helper, `BindGroupEntry<M>` discriminated union, `UniformField<M>`, `BindingVisibility` alias (ADR-0027 implementation).
- `packages/engine/src/material/prepare-bind-group.ts` — `schemaToBindGroupLayout`, `prepareBindGroup`, `uniformPackedSize` (ADR-0027 implementation).
- `packages/engine/src/material/materials.ts` — `Materials<M>`, `MaterialHandle<M>` branded type, `drainPendingChanges`.
- `packages/engine/src/material/render-materials.ts` — `RenderMaterials<M>`.
- `packages/engine/src/material/material-plugin.ts` — `MaterialPlugin<M>`; static `forExtended(Base, Extension)` for the wrapper case; extract / prepare / queue / draw systems.
- `packages/engine/src/material/extended-material.ts` — `ExtendedMaterial<B, E>` wrapper class.
- `packages/engine/src/material/standard-material.ts` — `StandardMaterial` class + bind-group schema.
- `packages/engine/src/material/pbr.wgsl` — PBR shader source, registered as `retro_engine::pbr`.
- `packages/engine/src/material/unlit-material.ts` — `UnlitMaterial`.
- `packages/engine/src/material/unlit.wgsl` — unlit shader, registered as `retro_engine::unlit`.
- `packages/engine/src/material/mesh-material-3d.ts` — `MeshMaterial3d<M>` component.
- `packages/engine/src/mesh/mesh-3d.ts` — `Mesh3d` component (re-exported through the engine root).
- `packages/engine/src/mesh/calculate-bounds.ts` — body filled.
- `packages/engine/src/camera/camera.ts` — `CameraDepthTarget` union, `Camera.depthTarget` field, `Camera2d()` / `Camera3d()` defaults.
- `packages/engine/src/camera/camera-bundles.ts` — `Camera3d()` factory sets `depthTarget: 'auto'`.
- `packages/engine/src/camera/view-depth-cache.ts` — `ViewDepthCache` render-world resource.
- `packages/engine/src/camera/camera-plugin.ts` — `prepareViewDepthTextures` system; `CameraView.depthView` field threaded through extract + prepare.
- `packages/engine/src/render-graph/phase-3d.ts` — `Opaque3d` / `AlphaMask3d` / `Transparent3d` phase-item types + per-camera phase-state resource.
- `packages/engine/src/render-graph/opaque-pass-3d-node.ts` — `OpaquePass3dNode` view node.
- `packages/engine/src/render-graph/transparent-pass-3d-node.ts` — `TransparentPass3dNode` view node.
- `packages/engine/src/render-graph/core-3d.ts` — `buildCore3dSubGraph` rewritten to register the trio.
- `packages/engine/src/render-graph/main-pass-node.ts` — TSDoc updated to "Core2d only"; `setBindGroup(0, ctx.view.viewBindGroup)` added immediately after `beginRenderPass`.
- `packages/engine/src/shader/pipeline-cache.ts` — `descriptorKey` expansion (depth-stencil, cull, front-face, blend, write-mask, sample-count); regression tests under `pipeline-cache.test.ts`.
- `packages/engine/src/index.ts` — re-exports for the material submodule + `Mesh3d`.
- `apps/playground/src/primitives-showcase-plugin.ts` — refactor from 436 LOC → ~150 LOC.
- `apps/playground/src/triangle-plugin.ts` — refactor to `UnlitMaterial`; color uniform moves to `@group(2)`.
- `docs/backlog/view-bind-group-zero-convention.md` — deleted after user confirms the convention is live in tree.
