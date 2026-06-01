# @retro-engine/renderer-core

## 0.1.0

### Minor Changes

- 3b3cf7f: feat(engine, renderer-core, renderer-webgpu): color-managed pipeline — sRGB swapchain + per-image color space (ADR-0049)

  Closes the color-management gap ADR-0048 made visible. The swapchain configures `viewFormats: [<base>-srgb]` and `Surface.getCurrentTextureView()` returns an sRGB-encoding view, so the hardware applies the sRGB OETF on store. `Image` gains a `colorSpace: 'srgb' | 'linear'` field (Bevy-shape) that drives whether `RenderImage`'s GPU texture uploads to the base or `-srgb` variant of the image's format. `fs_agx` re-adds the linearisation step (proper sRGB inverse OETF, not the gamma-2.2 approximation) so AgX round-trips bit-for-bit through the swapchain view's encode.

  The visible diff: scenes that were previously dimmed by ~2.2× under the tonemap path (`?mode=lit&hdr=1&tm=…`) now render at intended brightness. Image-heavy 2D scenes look perceptually identical because the two cancelling errors lift symmetrically. AgX specifically goes from "the special-case operator that looked roughly correct" to "the operator whose curve matches its reference implementation".

  **New public surface:**

  - `TextureFormat` (renderer-core) — adds `'rgba8unorm-srgb'` and `'bgra8unorm-srgb'`.
  - `srgbVariantOf(format: TextureFormat): TextureFormat` (renderer-core) — promotes a base format to its `-srgb` sibling; idempotent; noop for formats with no sRGB sibling.
  - `Image.colorSpace: 'srgb' | 'linear'` — Bevy-shape color-space flag. Defaults `'srgb'` from every factory.
  - `ImageColorSpace` — string-literal union exported alongside `Image`.
  - `ImageFactoryOptions` — shared options bag for `Image.solid` / `Image.checker` (`{ sampler?, label?, colorSpace? }`).

  **Behaviour changes:**

  - `Surface.format` now returns the **view** format (the `-srgb` variant of the canvas's preferred storage format). `Renderer.getPreferredSurfaceFormat()` unchanged — still returns the base storage format. Pipelines that already read `view.mainColorTarget.format` (sprite, material2d, light2d composite, tonemap, PBR) pick up the srgb variant automatically.
  - `Image.solid(rgba, opts?)` and `Image.checker(size, a, b, opts?)` move from positional `(rgba, sampler?, label?)` / `(size, a, b, sampler?, label?)` to an options-bag form. Old positional sites need mechanical updates: `Image.solid(rgba, undefined, 'L')` → `Image.solid(rgba, { label: 'L' })`.
  - `Image.fromBytes()` rejects explicit `'rgba8unorm-srgb'` / `'bgra8unorm-srgb'` formats — pass the base format and `colorSpace: 'srgb'` instead. The upload layer applies the variant from `colorSpace`.
  - `Image.WHITE` and `Image.BLACK` seed as `colorSpace: 'srgb'`; `Image.NORMAL_FLAT` seeds as `colorSpace: 'linear'`. `0.0` and `1.0` are bit-invariant under sRGB ↔ linear decode so WHITE / BLACK stay correct as multi-purpose StandardMaterial fallbacks; NORMAL_FLAT must be linear because `0.5` differs (`~0.214` linear if decoded as sRGB).
  - `bytesPerTexel('rgba8unorm-srgb')` / `bytesPerTexel('bgra8unorm-srgb')` both return `4` (same width as the base form).
  - Consumers writing data textures (normal maps, metallic / roughness / AO, displacement, atlas-layout LUTs) must pass `colorSpace: 'linear'` explicitly. Default `'srgb'` is the common case (a color texture); the failure mode for missed data-texture sites is silent sample corruption, not a runtime error.
  - `fs_agx` and `fs_blender_filmic` apply the piecewise inverse sRGB OETF before return — both operators' curves are fused tonemap + display encode, so under an sRGB-encoding swapchain view they need an explicit linearisation step to avoid double-encoding. The other operators (`None`, `Reinhard`, `ReinhardLuminance`, `ACES`, `SBDT`) output linear already — no shader change, but their visible brightness lifts because the swapchain view now applies the sRGB encode they were silently missing. All playground showcases re-tuned visually under the new pipeline.

- 8029403: feat(renderer): depth-stencil + cull HAL extensions

  Adds depth-test / depth-write configuration to `RenderPipelineDescriptor` and depth attachments to `RenderPassDescriptor`; extends `PrimitiveState` with cull mode and front-face winding. Per ADR-0026. First consumer is the Phase 6 playground showcase, which renders all 15 mesh primitives with depth testing + back-face culling — the first end-to-end visual verification of the Phase 6 mesh stack.

  **Public surface (`@retro-engine/renderer-core`):**

  - `DepthStencilState` — new interface on `RenderPipelineDescriptor.depthStencil?`. Fields: `format`, `depthWriteEnabled?` (default `true`), `depthCompare?` (default `'less'`).
  - `CompareFunction` — string union mirroring WebGPU's `GPUCompareFunction`.
  - `DepthStencilAttachment` — new interface on `RenderPassDescriptor.depthStencilAttachment?`. Fields: `view`, `depthLoadOp`, `depthStoreOp`, `depthClearValue?` (default 1.0), `depthReadOnly?`.
  - `PrimitiveState.cullMode?: CullMode` (`'none' | 'front' | 'back'`, default `'none'`).
  - `PrimitiveState.frontFace?: FrontFace` (`'ccw' | 'cw'`, default `'ccw'`).

  **WebGPU backend:**

  - `createRenderPipelineImpl` translates `depthStencil`, `primitive.cullMode`, `primitive.frontFace` to `GPURenderPipelineDescriptor`.
  - `beginRenderPass` translates `depthStencilAttachment` via a new `toDepthStencilAttachment` helper.

  **Deferred (per ADR-0026 "Not yet done"):**

  - Stencil state on `DepthStencilState`, stencil load/store ops on `DepthStencilAttachment` — outline / shadow-volume consumers.
  - Depth bias fields — Phase 10.4 shadow maps.
  - `Camera.depthTarget` and `MainPassNode` depth-attachment auto-management — when the built-in 3D pipeline ships.

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

- 9712180: feat(engine): screen-space ambient occlusion (GTAO) — ADR-0054

  Per ADR-0054, adds a per-camera `ScreenSpaceAo` component and a pre-opaque ambient-occlusion pass that reads the depth + normal prepass, estimates occlusion with a horizon search, denoises it, and feeds the result back into the lit forward shader's ambient term. AO darkens only the ambient/indirect lighting in creases and contact points — it is not a post-process over the final image, which would wrongly darken direct light.

  The pass chain is `Prepass → AO GTAO → AO blur → AO temporal → Opaque`:

  - **GTAO**, fragment-only (no compute/storage dependency → WebGL2-reachable; a compute speedup is deferred behind a capability flag). Depth + normal are read with `textureLoad` (no sampler), sidestepping depth-format filterability and sampling-uniformity hazards.
  - **Exact reconstruction under TAA jitter.** View-space position is reconstructed by inverting the _jittered_ projection (the matrix the depth was actually rasterized with), computed per AO-enabled camera on the CPU and uploaded in the AO params buffer — the shared view uniform is untouched, so non-AO cameras pay nothing. Resolves the latent reconstruction trap ADR-0053 flagged.
  - **Denoise:** a depth/normal-aware bilateral blur, plus motion-vector-reprojected temporal accumulation (a per-camera history ping-pong with disocclusion rejection) when a `MotionVectorPrepass` is present; otherwise blur-only.
  - **Forward feedback** through a new opaque `@group(3)` AO read binding: lit materials that declare `static usesAo` fork an `aoEnabled` pipeline variant (`#ifdef ENABLE_SSAO`) whose `fs_main` multiplies the sampled occlusion into the ambient term. `OpaquePass3dNode` binds the AO texture for the whole pass; pipelines that don't declare the group ignore it (same contract as the `@group(2)` lights binding). The pipeline key carries a stable `aoEnabled` boolean. This lands the previously deferred opaque `@group(3)` prepass-read binding — carrying the derived AO texture rather than raw prepass channels.

  **New public surface:**

  - `ScreenSpaceAo`, `DEFAULT_AO` — per-camera component (radius, intensity, bias, slices, steps).
  - `AoPlugin` — auto-installed by `CorePlugin`; warns-once-and-skips a camera lacking `DepthPrepass` + `NormalPrepass`.
  - `AoPipeline`, `AoBlurPipeline`, `AoTemporalPipeline`, `AoBindGroupCache`, `ViewAo`, `ViewAoTargets`, the AO nodes/labels, and the `AO_*_WGSL` modules.
  - `MaterialPipelineKey.aoEnabled`, `MaterialCtor.usesAo` (set on `StandardMaterial`).
  - `AO_TARGET_FORMAT` (`r8unorm`), `AO_HISTORY_FORMAT` (`rg16float`), `AO_PARAMS_BYTE_SIZE`.

  **Behaviour changes:**

  - The engine-managed `view-depth` texture is now allocated `RENDER_ATTACHMENT | TEXTURE_BINDING` (was attachment-only) so screen-space passes can sample it. Additive — the depth attachment usage is unchanged.
  - `@retro-engine/renderer-core` `TextureFormat` gains `r8unorm` (single-channel AO target). WebGPU passes it through natively; `bytesPerTexel` returns 1.
  - AO is 3D-only and opt-in; cameras without `ScreenSpaceAo`, and unlit/transparent materials, are unaffected (the non-AO pipeline variant is byte-identical).

  Browser-verified in `apps/playground` (`?mode=ao`, press O to toggle; `&taa=1` to check stability under jitter).

- bc24cd2: feat(engine): screen-space motion vectors — per-entity previous-instance buffer + fs_prepass_motion (ADR-0051)

  Activates the ADR-0050 motion-vector substrate. Cameras carrying `MotionVectorPrepass` now produce a per-pixel `rg16float` screen-space motion-vector target alongside the existing depth and normal targets. Unblocks Phase 12.6 TAA (the first consumer) and the motion-vector half of 12.10 motion blur.

  **New public surface:**

  - `PREVIOUS_INSTANCE_LAYOUT`, `PREVIOUS_INSTANCE_BYTE_SIZE`, `PREVIOUS_INSTANCE_FLOAT_COUNT`, `PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION`, `packPreviousInstanceTransform` — per-instance vertex layout + packer for the previous-frame model matrix. Stride 64 bytes, four `float32x4` columns at `@location(16..19)`, `stepMode: 'instance'`.
  - `MeshPreviousInstanceBuffer` — sibling of `MeshInstanceBuffer` carrying the per-entity previous-frame model matrix. Lazily allocated on the first frame a motion-enabled camera asks for it; mirrors the 1.5× growth + deferred-destroy lifecycle.
  - `INSTANCE_LAYOUT`, `MESH_INSTANCE_BYTE_SIZE`, `MESH_INSTANCE_FLOAT_COUNT`, `packInstanceTransform` — promoted from internal to the engine's public surface alongside the new previous-instance peers.
  - `'rg16float'` added to `@retro-engine/renderer-core`'s `TextureFormat` union (additive — the WebGPU backend passes the string through unmodified; existing consumers unaffected). `bytesPerTexel` returns 4.

  **Behaviour changes:**

  - `PREPASS_MOTION_VECTOR_FORMAT` narrows from the `'rgba16float'` placeholder to `'rg16float'` — half the bandwidth of the placeholder.
  - `MotionVectorPrepass` is no longer masked off in `PrepassPlugin`'s Extract — the marker now sets `flags.motionVector` to true alongside `DepthPrepass` and `NormalPrepass`. The one-shot `warnedMotionDeferred` dev-warn is removed.
  - `StandardMaterial.prepassWrites().motionVector` flips from `false` to `true`. `UnlitMaterial` stays depth-only (no normal data, no motion participation).
  - `pbr.wgsl` gains `fs_prepass_motion` (motion-only fragment, single `rg16float` target) and `fs_prepass_normal_motion` (combined normal + motion fragment, two targets in one fragment — keeps cardinality at one prepass pipeline per opt-in material per flag combination). Both entries are conditionally compiled under a new `#ifdef PREPASS_MOTION_VECTOR` define the material plugin sets per-variant.
  - `InstancedDrawPayload` gains an optional `previousInstanceBuffer?: Buffer` field; `makeInstancedDraw` binds it at vertex slot 2 when present. Opaque / transparent / non-motion-prepass payloads leave it undefined.
  - `MaterialPluginState` packs the previous-instance buffer in lockstep with the current-instance buffer when at least one active camera has motion enabled — same iteration order so `firstInstance + count` indexes both buffers identically.

- 7142f6f: feat(renderer): HAL stencil + depth-bias + blend extensions

  Adds the stencil and depth-bias halves of `DepthStencilState`, blend state and write-mask to `ColorTargetState`, stencil load/store ops to `DepthStencilAttachment`, and `setStencilReference` on `RenderPassEncoder`. Per ADR-0029. First consumer is Phase 7's `Material` system (ADR-0028): `StandardMaterial`'s `alpha_mode: 'blend'` configures the canonical premultiplied-alpha transparent pipeline, and `StandardMaterial.depth_bias` configures the Phase 10.4 shadow-map polygon offset.

  **Public surface (`@retro-engine/renderer-core`):**

  - `DepthStencilState` gains `stencilFront?`, `stencilBack?`, `stencilReadMask?`, `stencilWriteMask?`, `depthBias?`, `depthBiasSlopeScale?`, `depthBiasClamp?`.
  - `StencilOperation` and `StencilFaceState` — new types mirroring WebGPU's stencil shapes. Face state defaults to no-op.
  - `ColorTargetState.blend?: BlendState` and `ColorTargetState.writeMask?: ColorWriteFlags`.
  - `BlendState`, `BlendComponent`, `BlendOperation`, `BlendFactor` — new types mirroring WebGPU's blend shapes minus the feature-gated dual-source variants.
  - `ColorWrite` runtime constant + `ColorWriteFlags` type — bitfield mirroring `GPUColorWrite`.
  - `DepthStencilAttachment` gains `stencilClearValue?`, `stencilLoadOp?`, `stencilStoreOp?`, `stencilReadOnly?`.
  - `RenderPassEncoder.setStencilReference(reference)` — sets the dynamic stencil compare reference.
  - `TextureFormat` gains `'depth24plus'` and `'depth24plus-stencil8'` (baseline WebGPU formats; the stencil-bearing format is required for any stencil consumer).

  **WebGPU backend:**

  - `createRenderPipelineImpl` translates the new `DepthStencilState` fields (expanding `StencilFaceState` defaults to fully-specified records) and the new per-target `blend` / `writeMask`.
  - `toDepthStencilAttachment` translates stencil load/store ops, `stencilClearValue`, and `stencilReadOnly`.
  - `makeRenderPassEncoder` adds `setStencilReference`.

  **Deferred (per ADR-0029 "Not yet done"):**

  - Dual-source blending — requires a WebGPU feature flag; no in-tree consumer yet.
  - Stencil-only attachments (depth-stencil view with no depth aspect).
  - Per-target blend ergonomics helpers (`BlendState.standard`, `BlendState.additive`).
