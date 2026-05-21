# ADR-0003: Renderer Hardware Abstraction Layer (HAL)

- **Status:** Accepted
- **Date:** 2026-05-21

## Context

The engine must run in browsers on WebGPU today, and on WebGL2 in the future for environments where WebGPU isn't available (older browsers, certain mobile contexts). The two APIs differ significantly: WebGL2 lacks compute shaders, storage textures, indirect draw, timestamp queries, and uses a different binding model. We need a single engine codebase that can target either without rewrites, while keeping near-WebGPU performance when WebGPU is available.

We considered:
1. **WebGPU-direct, abstract later.** Fastest day-1 path, but every WebGPU API leak into engine code becomes load-bearing and expensive to undo.
2. **Full render graph from day 1** (Bevy-style passes with declared reads/writes). Cleanest long-term, but designing the graph before we know real use cases risks over-fitting.
3. **HAL/RHI interface + thin renderer.** A WebGPU-shaped interface in `renderer-core` (device, buffer, texture, pipeline, command encoder, etc.) that backends implement, with a simple renderer above it. Easy to add a render graph layer later without restructuring.

## Decision

Adopt option 3: a hardware abstraction layer (HAL) in `packages/renderer-core`, implemented by `packages/renderer-webgpu` for WebGPU and stubbed in `packages/renderer-webgl2` for the future WebGL2 backend.

- `renderer-core` exports **only types and interfaces**. No runtime code. Shapes mirror WebGPU's API but use our own names and only expose the surface we actually use.
- `renderer-webgpu` is the day-1 reference implementation. All HAL interfaces are wired to `GPUDevice`, `GPUBuffer`, etc.
- `renderer-webgl2` exists from day 1 as a stub: every method throws `Error("WebGL2 backend not implemented yet")`. The package is published so the contract is visible and downstream code's types resolve.
- `RendererCapabilities` is a struct on the renderer instance. Engine code that uses compute, storage textures, timestamp queries, or other WebGL2-incompatible features must check the capability flag and provide a fallback path.
- Engine packages depend only on `renderer-core` interfaces. A concrete backend is passed into `App` at startup.

## Consequences

**Easier:**
- WebGL2 backend, when written, slots in without touching engine code.
- Engine code is forced to think about capability gating from day 1.
- Cross-backend bugs are reproducible against a clear contract.

**Harder:**
- Every WebGPU call goes through one extra indirection. Cost is real but small.
- The HAL interface needs to be designed deliberately and will accrete as features need it. Mistakes here are felt across the codebase.
- We're committing to a HAL shape before we've written real rendering passes. Some HAL types will likely be refactored once we have the first real render pipeline. That's an expected cost.

## Implementation

- `packages/renderer-core/src/index.ts` — `Renderer`, `Device`, `Queue`, `Buffer`, `Texture`, `Sampler`, `BindGroup`, `BindGroupLayout`, `RenderPipeline`, `ComputePipeline`, `CommandEncoder`, `RenderPassEncoder`, `Surface`, `RendererCapabilities`
- `packages/renderer-webgpu/src/index.ts` — `createWebGPURenderer`
- `packages/renderer-webgl2/src/index.ts` — `createWebGL2Renderer` (throws)
- `packages/engine/src/index.ts` — `App` constructor accepts a `Renderer`
