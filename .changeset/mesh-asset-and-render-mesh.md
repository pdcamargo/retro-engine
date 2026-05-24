---
'@retro-engine/engine': minor
'@retro-engine/renderer-core': minor
'@retro-engine/renderer-webgpu': minor
'@retro-engine/renderer-webgl2': minor
---

feat(engine, renderer): mesh asset + RenderMesh + MeshAllocator + primitives + HAL vertex/index extensions (Renderer Phase 6)

The data layer Phase 7 (Material system) and Phase 8 (Sprites + Mesh2d) both block on. `Mesh`, `RenderMesh`, the page-based slab `MeshAllocator`, and the full primitive set ship together so Phase 7 wires up `Mesh3d` + `MeshMaterial3d<M>` against the final shape from day 1 — no draw-site refactor when materials land. Per ADR-0024 (mesh data + primitives + HAL extensions) and ADR-0025 (MeshAllocator).

**Public surface (`packages/engine/src/mesh/`):**

- `Mesh` — value class holding `attributes`, `indices?`, `primitiveTopology`, optional `label`. Builder API (`insertAttribute`, `withInsertedAttribute`, `setIndices`). Derived ops: `computeAabb`, `computeFlatNormals`, `computeSmoothNormals`, `checkConsistency`.
- `MeshVertexAttribute` + `MeshVertexAttributeId` (branded number) + `MeshAttribute` const-namespace with the well-known slots `POSITION` (id 0), `NORMAL` (id 1), `UV_0` (id 2), `TANGENT` (id 4), `COLOR` (id 5) — ids mirror Bevy verbatim so a future glTF importer doesn't need a remap table.
- `Indices` tagged union + `u16Indices` / `u32Indices` / `indicesFormat` / `indexByteSize` / `indexCount` helpers.
- `RenderMesh` + `MeshVertexBufferLayoutRef` + `interMeshVertexBufferLayout` — RenderMesh carries no buffer offsets and no buffer handles; the allocator is queried at draw time. Layout refs are hash-consed for identity-equal dedupe.
- `Meshes` — pre-asset-system registry mapping `MeshHandle` (branded number) → `Mesh`; emits `MeshAssetEvent` (`Added` / `Modified` / `Removed`) on every mutation. Folds into `Handle<Mesh>` + `AssetServer<Mesh>` when the asset system lands.
- `MeshAllocator` + `MeshAllocatorSettings` — page-based slab suballocator over shared GPU buffers. Defaults `minSlabSize: 1 MiB`, `maxSlabSize: 64 MiB`, `largeThreshold: 16 MiB`, `growthFactor: 1.5`. Slabs key per `MeshVertexBufferLayoutRef` (vertex) and per `IndexFormat` (index). Large-threshold allocations bypass slabs and get a dedicated buffer. Gated on `RendererCapabilities.baseVertex` — when `false` (WebGL2), every vertex allocation routes through the dedicated-buffer path. Ref-counted lifetime; first-fit free-list with coalescing.
- `MeshPlugin` — auto-registered by `CorePlugin` between `CameraPlugin` and `VisibilityPlugin` (so `calculateBoundsSystem` lands at the head of `VisibilityPlugin`'s documented `CalculateBounds → UpdateFrusta → VisibilityPropagate → CheckVisibility` order). Inserts `Meshes`, `MeshAllocator`, `MeshAllocatorSettings`, `ExtractedMeshAssetEvents`, `RenderMeshes`. Extract+prepare pipeline runs in `RenderSet.Extract` / `RenderSet.Prepare`, calling the allocator and populating `RenderMeshes`.
- `calculateBoundsSystem` — reserved slot per ADR-0021. Empty body in Phase 6; fills with the mesh-driven auto-AABB writer when `Mesh3d` lands.
- `Meshable` + `MeshBuilder` interfaces.
- 3D primitives — `Cuboid`, `Sphere` (ico + uv kind), `Cylinder`, `Capsule3d`, `Torus`, `Plane3d`, `Cone`, `Tetrahedron`, `ConicalFrustum`.
- 2D primitives — `Rectangle`, `Circle`, `Annulus`, `RegularPolygon`, `Triangle`, `Ellipse`.

**HAL extensions (`packages/renderer-core`, `packages/renderer-webgpu`, `packages/renderer-webgl2`):**

- `VertexFormat` (30 values mirroring WebGPU's `GPUVertexFormat`) + `vertexFormatByteSize` helper.
- `IndexFormat` (`'uint16' | 'uint32'`) + `indexFormatByteSize` helper.
- `VertexBufferLayout` / `VertexAttribute` / `VertexStepMode` types.
- `VertexState.buffers?: readonly VertexBufferLayout[]` on `RenderPipelineDescriptor`.
- `PrimitiveTopology` exported (was inline on `PrimitiveState.topology`).
- `RenderPassEncoder.setVertexBuffer(slot, buffer, offset?, size?)`, `setIndexBuffer(buffer, format, offset?, size?)`, extended `draw(vertexCount, instanceCount?, firstVertex?, firstInstance?)`, new `drawIndexed(indexCount, instanceCount?, firstIndex?, baseVertex?, firstInstance?)`.
- `RendererCapabilities.baseVertex: boolean` — `true` on WebGPU, `false` on the WebGL2 stub.

**Bench:**

- `packages/engine/bench/mesh-allocator.bench.ts` — three hot-path scenarios (steady-state allocate/free churn, grow under pressure, large-threshold burst). Joins the gate chain per CLAUDE.md §11.

**Deferred (per ADR-0024 / ADR-0025 "Not yet done"):**

- `Mesh3d` / `Mesh2d` ECS components, `MeshMaterial3d<M>` / `MeshMaterial2d<M>`, and mesh draw systems — Phase 7 (3D) / Phase 8 (2D `SpritePipeline`).
- Skinning attributes (`JOINT_INDEX`, `JOINT_WEIGHT`) — Phase 11.5.
- Morph targets — Phase 11.6.
- `generateTangents` (MikkTSpace port) — when normal-mapped materials need it.
- glTF attribute id 3 (second UV) — when a glTF mesh asks for it.
- Slab compaction, best-fit policy, async upload, per-layout settings overrides — each waits for a measured trigger.
- Asset-system `Handle<Mesh>` migration — when `@retro-engine/assets` lands.
