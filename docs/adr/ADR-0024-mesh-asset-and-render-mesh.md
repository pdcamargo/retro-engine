# ADR-0024: Mesh asset, RenderMesh, vertex-attribute slots, primitives, HAL vertex/index extensions

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

Renderer-roadmap Phase 6 is the data-layer landing the Material system (Phase 7) and the 2D rendering path (Phase 8) both block on. Both phases need three things in their final shape from day 1 so their draw-call sites don't refactor when Phase 6 ships:

- A `Mesh` value class with typed vertex-attribute slots a glTF importer (Phase 11) can populate and a `Material<M>::vertex_shader` can specialize against.
- A `RenderMesh` GPU representation that binds into a `RenderPassEncoder` without further plumbing — once the encoder accepts vertex / index buffers and the pipeline descriptor accepts `vertex.buffers`.
- A `MeshAllocator` (specified separately in ADR-0025) the draw site queries for buffer slices at draw time, so `RenderMesh` itself carries no buffer offsets and no buffer handles.

ADR-0018 closed the HAL gaps for buffer creation, texture/sampler allocation, and bind groups. It did not extend the encoder or the pipeline descriptor for vertex-buffered draws — those gaps remained because no consumer needed them. Phase 6 is the consumer.

ADR-0019 / ADR-0020 promised that the per-camera dispatch and render-set lifecycle (`Extract → Prepare → Queue → PhaseSort → Render → Cleanup`) would absorb Phase 6's upload pipeline without restructuring. ADR-0023's `MainPassNode` shim preserves that contract: this ADR's extract + prepare systems plug into the established sets; no graph rewrite.

ADR-0021 reserved the `CalculateBounds` slot at the head of `VisibilityPlugin`'s documented order; that slot lands here.

Out of scope for this ADR (each documented in §"Not yet done" with its trigger):

- **`Mesh3d` / `Mesh2d` ECS components** and **`MeshMaterial3d<M>` / `MeshMaterial2d<M>`** — meaningless without a paired material; Phase 7 owns them.
- **Draw systems** — Phase 7 (3D) and Phase 8 (2D, dedicated `SpritePipeline`).
- **Skinning attributes** (`JOINT_INDEX`, `JOINT_WEIGHT`) — wait for Phase 11.5 (glTF skinning).
- **Morph targets** — Phase 11.6.
- **`generateTangents` (MikkTSpace port)** — needed only when normal-mapped materials land.
- **MeshAllocator design** — its own ADR ([ADR-0025](ADR-0025-mesh-allocator.md)).

## Decision

1. **Phase 6 lives in `packages/engine/src/mesh/`.** One concern per file (CLAUDE.md §5.5). The submodule mirrors the established `camera/`, `visibility/`, `shader/`, `render-graph/` shape: a public surface re-exported through its own `index.ts`; the engine package root re-exports the submodule's names alongside the rest.

2. **`Mesh` is a plain value class.** Holds `attributes: Map<MeshVertexAttributeId, MeshAttributeData>` (insertion order preserved), optional `indices?: Indices`, `primitiveTopology: PrimitiveTopology`, and an optional `label`. Builder API: `mesh.insertAttribute(MeshAttribute.POSITION, Float32Array(...))` / `mesh.withInsertedAttribute(...)`. Derived ops: `computeAabb`, `computeFlatNormals`, `computeSmoothNormals`. `generateTangents` is deferred. Pre-asset-system shape: when `@retro-engine/assets` lands, `Mesh` becomes a typed asset; the class shape is the same in both worlds.

3. **`MeshVertexAttribute` is a `{ name, id, format }` triple.** `id` is `MeshVertexAttributeId`, a branded `number` so plain ids cannot accidentally substitute. The well-known attribute ids mirror Bevy verbatim:

   | Attribute  | Id | Format     |
   |------------|----|------------|
   | POSITION   | 0  | float32x3  |
   | NORMAL     | 1  | float32x3  |
   | UV_0       | 2  | float32x2  |
   | TANGENT    | 4  | float32x4  |
   | COLOR      | 5  | float32x4  |

   Id `3` is reserved (Bevy uses it for a second UV channel; we adopt the same slot when a consumer asks). `shaderLocation` is intentionally not part of the attribute — it's assigned by the material / pipeline that consumes the mesh, not by the mesh itself. Engine-defined slot ids live in `[0, 1024)`; plugin / user-defined ids should start at 1024.

4. **`Indices` is a tagged union over the two GPU-supported widths.** `{ kind: 'u16', data: Uint16Array } | { kind: 'u32', data: Uint32Array }`. Helpers `u16Indices`, `u32Indices`, `indicesFormat`, `indexByteSize`, `indexCount`. The two-arm shape lets the renderer pick the right `IndexFormat` at draw time without re-reading the data.

5. **`MeshVertexBufferLayoutRef` is identity-hashed.** `interMeshVertexBufferLayout(attributes, stepMode?)` returns a stable reference per `(attributes, stepMode)` tuple — first call builds and caches, subsequent calls return the same instance. Identity equality (`===`) is the dedupe primitive `PipelineCache` and `MeshAllocator` both rely on (mirrors the trade-off ADR-0022 §6 accepted for `PipelineLayout`).

6. **`RenderMesh` carries no buffer offsets and no buffer handles.** Fields are `{ vertexCount, bufferInfo, aabb, primitiveTopology, layout }`, where `bufferInfo` is `{ kind: 'indexed', indexCount, indexFormat } | { kind: 'non-indexed' }`. The {@link MeshAllocator} is queried at draw time via `allocator.vertexSlice(handle)` / `allocator.indexSlice(handle)`. This indirection is what makes `RenderMesh`'s shape final from day 1 — Phase 7's draw site is `pass.setVertexBuffer(0, slice.buffer, slice.offset); pass.setIndexBuffer(idxSlice.buffer, indexFormat, idxSlice.offset); pass.drawIndexed(indexCount, 1, 0, slice.baseVertex)` and that line never needs to change.

7. **`Meshes` is the pre-asset-system registry.** Main-world resource. `MeshHandle` is a branded `number`. API: `add(mesh): MeshHandle`, `get(handle)`, `mutate(handle, fn)`, `remove(handle)`, plus an internal `drainPendingChanges()` that yields `MeshAssetEvent` values for the extract system. Mirrors Bevy's `AssetEvent::{Added, Modified, Removed}` semantics. When `@retro-engine/assets` lands, `Meshes` folds into `AssetServer<Mesh>` and `MeshHandle` folds into `Handle<Mesh>`; the upgrade path is structural.

8. **`MeshPlugin` is engine-internal and inserted between `CameraPlugin` and `VisibilityPlugin`.** Registration order matters: `VisibilityPlugin`'s documented order (ADR-0021 §5) is `CalculateBounds → UpdateFrusta → VisibilityPropagate → CheckVisibility`. `CalculateBounds` is filled by `MeshPlugin`'s `'postUpdate'` slot; placing the plugin between `CameraPlugin` and `VisibilityPlugin` makes the registration-order-as-ordering primitive (ADR-0021 §"Consequences") put the bounds writer at the head of the visibility chain. The body of `calculateBoundsSystem` is empty in Phase 6 — the slot is anchored but the consumer (`Mesh3d`) doesn't exist yet; Phase 7 fills the body.

9. **The extract+prepare pipeline lives in `MeshPlugin`.** Two App resources — `ExtractedMeshAssetEvents` (queue) and `RenderMeshes` (`MeshHandle → RenderMesh` map) — bridge the two stages.
   - **Extract** (`RenderSet.Extract`): drains `Meshes.drainPendingChanges` into `ExtractedMeshAssetEvents`.
   - **Prepare** (`RenderSet.Prepare`): for each `Added` / `Modified`, packs the mesh's attributes into an interleaved byte buffer (insertion order = slot order), calls `MeshAllocator.allocateVertex` and (if indexed) `allocateIndex`, builds the `RenderMesh`, and stores it in `RenderMeshes`. For `Removed` / `Modified` (pre-allocation step), `freeVertex` / `freeIndex` runs first. Clears the queue at the end of the pass.
   - The split mirrors Bevy's extract-then-prepare convention exactly; downstream consumers in Phase 7 see exactly the shape Bevy materials see.

10. **`Meshable` and `MeshBuilder` are the primitive interfaces.** `Meshable.mesh(): MeshBuilder` and `MeshBuilder.build(): Mesh`. Concrete builders may layer extra methods that mutate stored options and return `this`, mirroring Bevy's `.ico(5).build()` shape. Primitives produced by builders ship with `POSITION` + `NORMAL` + `UV_0` attributes, indices (`Uint32Array`), and `'triangle-list'` topology unless otherwise documented.

11. **Primitives ship in full sets, not gated.** 3D: `Cuboid`, `Sphere` (ico + uv with builder kind), `Cylinder`, `Capsule3d`, `Torus`, `Plane3d`, `Cone`, `Tetrahedron`, `ConicalFrustum`. 2D: `Rectangle`, `Circle`, `Annulus`, `RegularPolygon`, `Triangle`, `Ellipse`. Each is ~50 LOC — pure geometric type + builder + `build()`. They live together (not split between `math` and `engine`) because no current consumer needs the geometric type without the mesh adapter.

12. **HAL extensions — the gap that blocked any vertex-buffered draw.** Phase 6 extends `renderer-core` and `renderer-webgpu`:
    - `VertexFormat` (string union mirroring WebGPU's `GPUVertexFormat`, 30 values).
    - `IndexFormat` (`'uint16' | 'uint32'`).
    - `vertexFormatByteSize(format)` and `indexFormatByteSize(format)` helpers.
    - `VertexBufferLayout = { arrayStride, stepMode?, attributes: VertexAttribute[] }` with `VertexAttribute = { shaderLocation, format, offset }` and `VertexStepMode = 'vertex' | 'instance'`.
    - `VertexState.buffers?: readonly VertexBufferLayout[]` on `RenderPipelineDescriptor`.
    - `PrimitiveTopology` exported (was inline on `PrimitiveState.topology`).
    - `RenderPassEncoder.setVertexBuffer(slot, buffer, offset?, size?)`, `setIndexBuffer(buffer, format, offset?, size?)`, extended `draw(vertexCount, instanceCount?, firstVertex?, firstInstance?)`, and new `drawIndexed(indexCount, instanceCount?, firstIndex?, baseVertex?, firstInstance?)`.
    - `RendererCapabilities.baseVertex: boolean` — `true` on WebGPU, `false` on the WebGL2 stub. The mesh allocator gates shared-slab vertex packing on this flag (see ADR-0025).
    - WebGPU backend implements all of the above; the WebGL2 stub extends its throw set and reports `baseVertex: false`. No new ADR for the HAL surface change because it is tightly coupled to the mesh-draw consumer that motivates it.

Composition-only. `App` gains no new fields; `RenderContext` is unchanged; no abstract `Mesh` / `RenderMesh` / `Meshable` base class. The HAL types are extended structurally — `VertexState` grows an optional field, `RenderPassEncoder` grows methods; nothing is subclassed.

## Consequences

**Easier:**

- Phase 7's `Material<M>` extract + queue + draw systems read `RenderMeshes`, query `MeshAllocator.vertexSlice(handle)` / `indexSlice(handle)`, and emit `setVertexBuffer` + `setIndexBuffer` + `drawIndexed` — no refactor of `Mesh`, `RenderMesh`, or the allocator required when the material trait lands.
- Phase 8's sprite pipeline (`SpritePipeline`) and its `Material2d` cousin land on the same data layer; a sprite is one quad mesh, an arbitrary 2D shape is any other primitive's mesh.
- Phase 11 (glTF) maps directly onto the typed attribute slots: POSITION/NORMAL/UV_0/TANGENT/COLOR ids are Bevy-compatible, so a `Gltf` loader translates glTF's primitive attributes without a remap table.
- Plugins author custom geometry by writing a `Meshable` impl with a `build()` body — no class hierarchy to fit into. The full primitive set ships as reference implementations.
- The HAL is now feature-complete for any vertex-buffered draw — Phase 7 / 8 / 9 / 10 add code on top of it without touching renderer-core/renderer-webgpu again until the WebGL2 backend lands.

**Harder / accepted trade-offs:**

- **`Mesh3d` / `Mesh2d` are absent from Phase 6.** Tests + benches witness Phase 6 correctness; the first visible mesh appears in Phase 7. The user explicitly traded a Phase 6 demo for "wired up against final shape from day 1" in Phase 7.
- **The pre-asset-system handle (`MeshHandle` + `Meshes` registry)** carries the cost of a migration when the asset system lands. The shape was picked to make that migration structural (numeric branded id → `Handle<Mesh>`), not behavioural.
- **`MeshVertexBufferLayoutRef` is a global hash-cons.** Two distinct shaders that conceptually want different layouts but produce structurally-identical attribute orders share a ref. This is the right call for dedupe — the layout *is* the same — but it means `===` comparisons over refs are equivalent to deep structural equality on the underlying tuple.
- **`calculateBoundsSystem`'s empty body is an aspirational slot.** A reader expecting four registered systems in the visibility chain sees four registrations, but the first has no body. The TSDoc on the system calls this out explicitly; Phase 7 fills it.
- **The HAL surface grew without a separate ADR.** `setVertexBuffer` / `setIndexBuffer` / `drawIndexed` / `VertexBufferLayout` / `VertexFormat` / `IndexFormat` / `baseVertex` capability all land here. The alternative — a Phase-6-only ADR-0024 for mesh data + a Phase-6-only ADR-0025 for HAL extensions — was rejected because the HAL extensions have no consumer outside this phase; bundling them with the consumer is honest about the coupling.
- **Per-vertex packing is interleaved, not separate buffers.** All attributes for one mesh pack into a single byte buffer; `setVertexBuffer(0, ...)` binds it. The alternative (Bevy's optional separate-buffer-per-attribute path used for some compressed formats) is deferred until a consumer needs it. Today's drawback: a shader that uses only POSITION still reads the full stride per vertex.

## Not yet done

Each entry below is deferred until its trigger consumer lands. None is hidden in code — the only way to find these gaps is this ADR.

- **`Mesh3d` / `Mesh2d` / `MeshMaterial3d<M>` / `MeshMaterial2d<M>`** — Phase 7 / Phase 8.
- **Draw systems** — Phase 7 (3D) + Phase 8 (2D `SpritePipeline`).
- **`calculateBoundsSystem` body** — fills when `Mesh3d` exists and entities can carry a mesh handle.
- **Skinning attributes (`JOINT_INDEX`, `JOINT_WEIGHT`)** — Phase 11.5.
- **Morph targets** — Phase 11.6.
- **`generateTangents` (MikkTSpace port)** — when normal-mapped materials need it.
- **glTF attribute id 3** (second UV) — when a glTF mesh asks for it.
- **Per-attribute separate-buffer packing** — when a compressed-attribute consumer asks.
- **Asset-system `Handle<Mesh>` migration** — when `@retro-engine/assets` lands.

## Implementation

- `packages/renderer-core/src/formats.ts` — `VertexFormat`, `IndexFormat`, `vertexFormatByteSize`, `indexFormatByteSize`.
- `packages/renderer-core/src/pipeline.ts` — `VertexBufferLayout`, `VertexAttribute`, `VertexStepMode`, `PrimitiveTopology`, `VertexState.buffers`.
- `packages/renderer-core/src/encoder.ts` — `RenderPassEncoder.setVertexBuffer`, `setIndexBuffer`, `drawIndexed`, extended `draw`.
- `packages/renderer-core/src/capabilities.ts` — `RendererCapabilities.baseVertex`.
- `packages/renderer-core/src/index.ts` — re-exports the new types.
- `packages/renderer-webgpu/src/encoder.ts` — `setVertexBuffer` / `setIndexBuffer` / `drawIndexed` impls; 4-arg `draw`.
- `packages/renderer-webgpu/src/pipeline.ts` — `VertexBufferLayout` → `GPUVertexBufferLayout` translation in `createRenderPipelineImpl`.
- `packages/renderer-webgpu/src/index.ts` — `baseVertex: true` in capabilities.
- `packages/renderer-webgl2/src/index.ts` — `baseVertex: false` in capabilities (throw set inherited).
- `packages/engine/src/mesh/vertex-attribute.ts` — `MeshVertexAttribute`, `MeshVertexAttributeId`, `meshVertexAttribute`, `meshVertexAttributeId`, `MeshAttribute` const-namespace.
- `packages/engine/src/mesh/indices.ts` — `Indices` tagged union + helpers (`u16Indices`, `u32Indices`, `indicesFormat`, `indexByteSize`, `indexCount`).
- `packages/engine/src/mesh/mesh.ts` — `Mesh` value class + `MeshAttributeData`; `computeAabb` / `computeFlatNormals` / `computeSmoothNormals` / `checkConsistency`.
- `packages/engine/src/mesh/render-mesh.ts` — `RenderMesh`, `RenderMeshBufferInfo`, `MeshVertexBufferLayoutRef`, `interMeshVertexBufferLayout`.
- `packages/engine/src/mesh/meshes.ts` — `Meshes` registry, `MeshHandle`, `MeshAssetEvent`.
- `packages/engine/src/mesh/calculate-bounds.ts` — `calculateBoundsSystem` (slot reserved per ADR-0021; body fills with `Mesh3d`).
- `packages/engine/src/mesh/mesh-plugin.ts` — `MeshPlugin`, `ExtractedMeshAssetEvents`, `RenderMeshes`.
- `packages/engine/src/mesh/primitives/meshable.ts` — `Meshable`, `MeshBuilder`.
- `packages/engine/src/mesh/primitives/cuboid.ts` — `Cuboid`, `CuboidMeshBuilder`.
- `packages/engine/src/mesh/primitives/sphere.ts` — `Sphere`, `SphereMeshBuilder`, `SphereKind`.
- `packages/engine/src/mesh/primitives/cylinder.ts` — `Cylinder`, `CylinderMeshBuilder`.
- `packages/engine/src/mesh/primitives/capsule3d.ts` — `Capsule3d`, `Capsule3dMeshBuilder`.
- `packages/engine/src/mesh/primitives/torus.ts` — `Torus`, `TorusMeshBuilder`.
- `packages/engine/src/mesh/primitives/plane3d.ts` — `Plane3d`, `Plane3dMeshBuilder`.
- `packages/engine/src/mesh/primitives/cone.ts` — `Cone`, `ConeMeshBuilder`.
- `packages/engine/src/mesh/primitives/tetrahedron.ts` — `Tetrahedron`, `TetrahedronMeshBuilder`.
- `packages/engine/src/mesh/primitives/conical-frustum.ts` — `ConicalFrustum`, `ConicalFrustumMeshBuilder`.
- `packages/engine/src/mesh/primitives/2d/rectangle.ts` — `Rectangle`, `RectangleMeshBuilder`.
- `packages/engine/src/mesh/primitives/2d/circle.ts` — `Circle`, `CircleMeshBuilder`.
- `packages/engine/src/mesh/primitives/2d/annulus.ts` — `Annulus`, `AnnulusMeshBuilder`.
- `packages/engine/src/mesh/primitives/2d/regular-polygon.ts` — `RegularPolygon`, `RegularPolygonMeshBuilder`.
- `packages/engine/src/mesh/primitives/2d/triangle.ts` — `Triangle`, `TriangleMeshBuilder`.
- `packages/engine/src/mesh/primitives/2d/ellipse.ts` — `Ellipse`, `EllipseMeshBuilder`.
- `packages/engine/src/mesh/index.ts` — mesh module re-exports.
- `packages/engine/src/core-plugin.ts` — `CorePlugin` registers `MeshPlugin` between `CameraPlugin` and `VisibilityPlugin`.
- `packages/engine/src/index.ts` — re-exports the mesh module's public surface.
- `packages/engine/src/test-utils.ts` — `baseCapabilities.baseVertex`; `RenderPassEncoder` stub gains `setVertexBuffer` / `setIndexBuffer` / `drawIndexed`.
- `packages/engine/bench/helpers.ts` — same updates to the bench renderer stub.
