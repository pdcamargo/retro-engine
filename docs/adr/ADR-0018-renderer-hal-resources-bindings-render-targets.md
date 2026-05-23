# ADR-0018: Renderer HAL — resources, bind groups, render targets

- **Status:** Accepted
- **Date:** 2026-05-23

## Context

ADR-0003 set up the HAL with a minimal surface: shader-module compilation, render pipelines (layout fixed at `'auto'`), command encoders, render passes that bind a single swapchain attachment, and submit. That was enough for the first render path (pink triangle) and intentionally left every consumer-facing GPU resource type — buffers, textures, samplers, bind groups, pipeline layouts — out of the contract.

Phase 1 of the renderer roadmap (`docs/roadmap/renderer.md`) closes that gap. Every later phase (cameras, materials, sprites, lighting, post-processing, glTF) needs to allocate buffers, sample textures, and bind resources to a pipeline. `RenderPassEncoder.setBindGroup` was a deliberate placeholder that threw with `bind groups arrive with sprite rendering` — that day is now. Cameras (Phase 2) also need to render to images, not just swapchains, so the `RenderTarget` abstraction lands here so it can be load-bearing before any camera component exists.

## Decision

Extend `@retro-engine/renderer-core` with the resource and binding surface every later renderer phase consumes, and wire it through the WebGPU backend.

- Add **resource factories** to `Renderer`: `createBuffer`, `createTexture`, `createSampler`, `writeBuffer`, `writeTexture`. Buffers expose `size` + `usage`. Textures expose `width`, `height`, `depthOrArrayLayers`, `format`, `mipLevelCount`, `sampleCount`, `usage`, and a `createView(descriptor?)` method.
- Add **binding factories**: `createBindGroupLayout`, `createPipelineLayout`, `createBindGroup`. Bind-group entries accept the three resource forms — `BufferBinding`, `Sampler`, `TextureView` — distinguished by the backend through the existing symbol-keyed handle pattern.
- **Widen `RenderPipelineDescriptor.layout`** from `'auto'` only to `'auto' | PipelineLayout`. Backwards compatible: existing `'auto'` callers (the playground triangle, before this milestone) keep working.
- **Implement `RenderPassEncoder.setBindGroup`** — the WebGPU backend extracts the bind group's `GPUBindGroup` handle via the new `GPU_BIND_GROUP` symbol and calls through.
- Add a **`RenderTarget` tagged union** (`'surface' | 'texture' | 'view'`) and `Renderer.resolveRenderTarget(target)` that returns a `ResolvedRenderTarget` carrying `{ view, format, width, height }`. Phase 1 ships all three variants so that Phase 2 cameras can target offscreen images and externally-built views without growing the contract again.
- **Usage flags are numeric bitfields** exposed as const-namespaces — `BufferUsage`, `TextureUsage`, `ShaderStage`. Values match WebGPU (`GPUBufferUsage`, `GPUTextureUsage`, `GPUShaderStage`) so the WebGPU backend can pass them straight through. Other backends translate to their own model.
- **`Surface` gains `format`/`width`/`height` getters** so `resolveRenderTarget` can build a `ResolvedRenderTarget` for surface targets without re-reading the canvas every frame.

The HAL stays composition-only (per ADR-0001 §5.1, CLAUDE.md §5): every new type is a structural interface, every new factory is a method on `Renderer`. No base classes, no abstract handles. Symbol-keyed backend handles continue per ADR-0003 §Implementation.

`renderer-core/src/index.ts` is now a public re-export entry point only (CLAUDE.md §5.5). Concerns live in sibling files: `capabilities.ts`, `formats.ts`, `shader.ts`, `resources.ts`, `binding.ts`, `pipeline.ts`, `encoder.ts`, `surface.ts`, `render-target.ts`. The WebGPU backend mirrors the split.

## Consequences

**Easier:**

- Phase 2 (cameras) can land without further HAL extension — `Camera.target: RenderTarget` and `Camera.clearColor` consume the new `ResolvedRenderTarget` directly.
- Phases 4 (shader system) and 7 (materials) can register `PipelineLayout`s and `BindGroupLayout`s as first-class assets, not work around `'auto'`-only pipelines.
- Sprite rendering (Phase 8) and any uniform-driven pass now has a witnessed end-to-end path: `createBuffer(UNIFORM | COPY_DST)` → `writeBuffer` → `createBindGroupLayout` → `createPipelineLayout` → `createBindGroup` → `setBindGroup` inside the render pass. Witnessed by the pulsing triangle in `apps/playground`.
- The render-world split (ADR-0019, milestone B) has concrete GPU resources to extract / prepare / bind, not just abstract entity data.

**Harder / accepted trade-offs:**

- Bind-group construction is verbose in TypeScript. We do not have derive macros, so end-user code that wires a uniform struct's fields into bind-group entries is hand-written today. A higher-level `AsBindGroup`-equivalent is its own ADR (flagged in `docs/roadmap/renderer.md` Phase 7 open questions); the HAL is the foundation that abstraction will be built on, not a replacement for it.
- Numeric bitfield flags mean a typo (e.g. passing `0x40` where `BufferUsage.UNIFORM` is meant) compiles. We accepted this in exchange for clean bitwise-OR composition; the named constants are the recommended call style, and runtime validation in the backend catches invalid combinations.
- The WebGL2 backend's binding-model translation (Phase 14.2) now has a much wider surface to cover. Capability flags (`computeShaders`, `storageTextures`, `indirectDraw`) gate the most divergent features; the bind-group / pipeline-layout shape itself is uniform-buffer-friendly and translatable.
- `BindingResource` is a union of `BufferBinding | Sampler | TextureView`. `Sampler` and `TextureView` are both `{ destroy(): void }` at the HAL level — runtime discrimination happens in the backend via the per-type symbol. This is invisible to consumers; it would matter only if a future HAL test wanted to introspect resources, which it doesn't.

## Implementation

- `packages/renderer-core/src/` —
  - `index.ts` — `Renderer` interface + public re-exports.
  - `capabilities.ts` — `RendererCapabilities`.
  - `formats.ts` — `TextureFormat`, `ClearColor`.
  - `shader.ts` — `ShaderModule`, `ShaderModuleDescriptor`.
  - `resources.ts` — `Buffer`, `BufferDescriptor`, `BufferUsage`, `BufferUsageFlags`; `Texture`, `TextureDescriptor`, `TextureUsage`, `TextureUsageFlags`; `TextureView`, `TextureViewDescriptor`; `Sampler`, `SamplerDescriptor`; `ImageCopyTexture`, `ImageDataLayout`, `Extent3D`.
  - `binding.ts` — `BindGroup`, `BindGroupDescriptor`, `BindGroupEntry`; `BindGroupLayout`, `BindGroupLayoutDescriptor`, `BindGroupLayoutEntry`; `BufferBinding`, `BufferBindingLayout`, `SamplerBindingLayout`, `TextureBindingLayout`, `StorageTextureBindingLayout`; `PipelineLayout`, `PipelineLayoutDescriptor`; `ShaderStage`, `ShaderStageFlags`; `BindingResource`.
  - `pipeline.ts` — `RenderPipeline`, `RenderPipelineDescriptor`, `VertexState`, `FragmentState`, `ColorTargetState`, `PrimitiveState`, `ComputePipeline`.
  - `encoder.ts` — `CommandEncoder`, `CommandBuffer`, `RenderPassEncoder`, `RenderPassDescriptor`, `ColorAttachment`.
  - `surface.ts` — `Surface`, `SurfaceConfiguration` (now with `format`/`width`/`height` getters).
  - `render-target.ts` — `RenderTarget`, `ResolvedRenderTarget`.
- `packages/renderer-webgpu/src/` —
  - `index.ts` — `createWebGPURenderer` composition.
  - `symbols.ts` — `GPU_*` symbol keys + `Internal*` interfaces for every HAL handle.
  - `resources.ts` — `createBufferImpl`, `createTextureImpl`, `createSamplerImpl`, `writeBufferImpl`, `writeTextureImpl`, `wrapTextureView`.
  - `binding.ts` — `createBindGroupLayoutImpl`, `createPipelineLayoutImpl`, `createBindGroupImpl`.
  - `pipeline.ts` — `createShaderModuleImpl`, `createRenderPipelineImpl`.
  - `encoder.ts` — `makeCommandEncoder`, `makeRenderPassEncoder` (now implements `setBindGroup`).
  - `surface.ts` — `makeSurface`.
  - `render-target.ts` — `resolveRenderTargetImpl`.
- `packages/renderer-webgl2/src/index.ts` — stub `createWebGL2Renderer` extended to throw on every new method.
- `packages/engine/src/test-utils.ts` — shared `makeHeadlessRenderer` / `makeRenderingRenderer` helpers, excluded from the shipped build via `tsconfig.build.json`. Inline stubs were removed from all 16 engine test files.
- `apps/playground/src/triangle-plugin.ts` — pulses the triangle's color via a uniform buffer + explicit `BindGroupLayout` / `PipelineLayout` / `BindGroup`, witnessing the full HAL surface end-to-end.
