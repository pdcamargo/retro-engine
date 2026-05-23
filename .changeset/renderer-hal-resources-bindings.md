---
'@retro-engine/renderer-core': minor
'@retro-engine/renderer-webgpu': minor
'@retro-engine/renderer-webgl2': minor
'@retro-engine/engine': patch
---

feat(renderer-hal): resource factories, bind groups, and render targets (ADR-0018)

Closes the HAL gaps Phase 1 of the renderer roadmap calls out — every later phase (cameras, materials, sprites, lighting) needs to allocate buffers, sample textures, and bind resources to a pipeline.

### Resource factories

`Renderer` gains `createBuffer`, `createTexture`, `createSampler`, `writeBuffer`, `writeTexture`. Buffers expose `size` + `usage`. Textures expose dimensions, format, mip/sample counts, usage flags, and `createView(descriptor?)`.

Usage flags are numeric bitfields exposed via const-namespaces — `BufferUsage`, `TextureUsage` — whose values match WebGPU's `GPUBufferUsage` / `GPUTextureUsage` for zero-cost passthrough in the WebGPU backend.

### Binding model

`Renderer` gains `createBindGroupLayout`, `createPipelineLayout`, `createBindGroup`. `RenderPipelineDescriptor.layout` widens from `'auto'` only to `'auto' | PipelineLayout`. `RenderPassEncoder.setBindGroup` is now implemented (previously threw with "bind groups arrive with sprite rendering").

`ShaderStage` const-namespace exposes `VERTEX`, `FRAGMENT`, `COMPUTE` bits matching WebGPU. Bind-group layout entries accept `buffer | sampler | texture | storageTexture` discriminators.

```ts
const layout = renderer.createBindGroupLayout({
  entries: [{ binding: 0, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
});
const pipelineLayout = renderer.createPipelineLayout({ bindGroupLayouts: [layout] });
const bindGroup = renderer.createBindGroup({
  layout,
  entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
});

renderer.createRenderPipeline({ layout: pipelineLayout, /* ... */ });
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
