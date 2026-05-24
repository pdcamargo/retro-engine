---
'@retro-engine/renderer-core': minor
'@retro-engine/renderer-webgpu': minor
---

feat(renderer): depth-stencil + cull HAL extensions

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
