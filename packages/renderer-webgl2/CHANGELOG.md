# @retro-engine/renderer-webgl2

## 0.1.0

### Minor Changes

- 9e2aaf5: feat(editor-sdk): custom font loading (JetBrains Mono default + named faces)

  Add font support to the UI layer. `renderer-core`'s `SurfaceOverlay` gains `loadFont(name, data)` (each backend forwards to the binding's font store); `editor-sdk` adds `registerFonts` / `FontSpec`, a `fonts` plugin option (async — bytes are typically fetched) that registers faces, sets the default (`io.FontDefault`) and base size, and `ui.withFont(name, size, body)` to render a scope in a named face (e.g. a pixel display font). Uses Dear ImGui 1.92's size-scalable font path. Font files are supplied by the consumer; none are bundled.

- 0eca147: feat(editor-sdk): immediate-mode UI layer over Dear ImGui (ADR-0072)

  Adds `@retro-engine/editor-sdk` with a normalized, typed, tokenized immediate-mode `ui` wrapper over `@mori2003/jsimgui` — the only public UI surface; raw jsimgui stays internal. `renderer-core` gains a backend-neutral `SurfaceOverlay` contract; `renderer-webgpu` and `renderer-webgl2` each implement it (`createImGuiOverlay(renderer)`), with the device-specific draw kept behind the HAL. The overlay backend is selected from the active renderer at runtime (WebGPU-first, WebGL2 reachable), injected at startup, and themed by design tokens. Includes optional window docking (`uiOverlayPlugin({ docking: true })`, `ui.dockSpaceOverViewport`, per-window `dock`) and dock-layout save/restore via `saveLayout`/`loadLayout` and a `layout` option (default layout + consumer-provided persist/restore sinks) so an editor can ship a default layout and persist user changes.

- 8029403: feat(engine, renderer): mesh asset + RenderMesh + MeshAllocator + primitives + HAL vertex/index extensions (Renderer Phase 6)

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

- fa2678b: feat(renderer-hal): resource factories, bind groups, and render targets (ADR-0018)

  Closes the HAL gaps Phase 1 of the renderer roadmap calls out — every later phase (cameras, materials, sprites, lighting) needs to allocate buffers, sample textures, and bind resources to a pipeline.

  ### Resource factories

  `Renderer` gains `createBuffer`, `createTexture`, `createSampler`, `writeBuffer`, `writeTexture`. Buffers expose `size` + `usage`. Textures expose dimensions, format, mip/sample counts, usage flags, and `createView(descriptor?)`.

  Usage flags are numeric bitfields exposed via const-namespaces — `BufferUsage`, `TextureUsage` — whose values match WebGPU's `GPUBufferUsage` / `GPUTextureUsage` for zero-cost passthrough in the WebGPU backend.

  ### Binding model

  `Renderer` gains `createBindGroupLayout`, `createPipelineLayout`, `createBindGroup`. `RenderPipelineDescriptor.layout` widens from `'auto'` only to `'auto' | PipelineLayout`. `RenderPassEncoder.setBindGroup` is now implemented (previously threw with "bind groups arrive with sprite rendering").

  `ShaderStage` const-namespace exposes `VERTEX`, `FRAGMENT`, `COMPUTE` bits matching WebGPU. Bind-group layout entries accept `buffer | sampler | texture | storageTexture` discriminators.

  ```ts
  const layout = renderer.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: ShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });
  const pipelineLayout = renderer.createPipelineLayout({
    bindGroupLayouts: [layout],
  });
  const bindGroup = renderer.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  renderer.createRenderPipeline({ layout: pipelineLayout /* ... */ });
  pass.setBindGroup(0, bindGroup);
  ```

  ### RenderTarget abstraction

  New `RenderTarget` tagged union (`surface | texture | view`) and `Renderer.resolveRenderTarget(target)` that returns `{ view, format, width, height }`. Phase 1 ships all three variants so future cameras (Phase 2) can target offscreen images without further HAL extension. `Surface` gains `format` / `width` / `height` getters to support surface-backed targets.

  ### File layout

  `packages/renderer-core/src/index.ts` is now a public re-export entry point only, per CLAUDE.md §5.5. Concerns live in sibling files: `capabilities.ts`, `formats.ts`, `shader.ts`, `resources.ts`, `binding.ts`, `pipeline.ts`, `encoder.ts`, `surface.ts`, `render-target.ts`. The WebGPU backend mirrors the split. Engine consumers continue importing from `@retro-engine/renderer-core` — no path changes.

  ### API surface (additive, no breakage)

  - New methods on `Renderer`: `createBuffer`, `createTexture`, `createSampler`, `writeBuffer`, `writeTexture`, `createBindGroupLayout`, `createPipelineLayout`, `createBindGroup`, `resolveRenderTarget`.
  - New types: `BufferDescriptor`, `TextureDescriptor`, `TextureViewDescriptor`, `SamplerDescriptor`, `BindGroupLayoutDescriptor`, `BindGroupLayoutEntry`, `PipelineLayoutDescriptor`, `BindGroupDescriptor`, `BindGroupEntry`, `BufferBinding`, `BindingResource`, `RenderTarget`, `ResolvedRenderTarget`, `ImageCopyTexture`, `ImageDataLayout`, `Extent3D`, plus binding-layout sub-types.
  - New const-namespaces: `BufferUsage`, `TextureUsage`, `ShaderStage`.
  - `Surface` gains `format`, `width`, `height` getters.
  - `Buffer` gains `usage`; `Texture` gains `depthOrArrayLayers`, `format`, `mipLevelCount`, `sampleCount`, `usage`, `createView`.

  ### Engine touch

  `packages/engine/src/test-utils.ts` consolidates `makeHeadlessRenderer` / `makeRenderingRenderer` so the engine's 16 test files don't each maintain their own `Renderer` stub. Excluded from the shipped build via `tsconfig.build.json` — no API surface change.

  ### ADR provenance

  - Seals ADR-0018.
  - Sits on top of ADR-0003 (renderer HAL) — extends the contract; does not supersede it.
  - Foundation for ADR-0019 (render world + render schedule sets, milestone B) and every later renderer-roadmap phase.

### Patch Changes

- Updated dependencies [3b3cf7f]
- Updated dependencies [8029403]
- Updated dependencies [9e2aaf5]
- Updated dependencies [0eca147]
- Updated dependencies [8029403]
- Updated dependencies [fa2678b]
- Updated dependencies [9712180]
- Updated dependencies [bc24cd2]
- Updated dependencies [7142f6f]
  - @retro-engine/renderer-core@0.1.0
