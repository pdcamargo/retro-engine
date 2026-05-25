---
'@retro-engine/renderer-core': minor
'@retro-engine/renderer-webgpu': minor
---

feat(renderer): HAL stencil + depth-bias + blend extensions

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
