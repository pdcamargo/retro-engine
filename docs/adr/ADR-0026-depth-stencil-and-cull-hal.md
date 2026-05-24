# ADR-0026: Depth-stencil + cull HAL extensions

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

ADR-0024 closed the HAL gap for vertex-buffered draws: `setVertexBuffer`, `setIndexBuffer`, `drawIndexed`, `VertexBufferLayout`, `VertexFormat`, `IndexFormat`, `baseVertex` capability. It deliberately did *not* extend the HAL with depth-stencil state or cull mode, because no in-tree consumer needed them at the time the Phase 6 ADR sealed.

The first such consumer appeared the moment we tried to visually verify the Phase 6 primitives in the playground. Without depth testing, every 3D mesh in `apps/playground/src/primitives-showcase-plugin.ts` is drawn with last-triangle-wins semantics — the back face of a cube overpaints its front face, a sphere reduces to a solid disk the color of its last triangle, and so on. Without back-face culling, even individual shapes display interior triangles drawn after exterior ones, producing visual garbage. Both are needed before "shapes side-by-side" is meaningful.

ADR-0024's "HAL extensions" section did anticipate that further HAL surface would land tied to the next consumer that needs it ("bundling them with the consumer is honest about the coupling"). This ADR is the next slice — small enough to record as one decision, large enough to record at all because it reshapes `RenderPipelineDescriptor` and `RenderPassDescriptor`.

Out of scope for this ADR (each documented in §"Not yet done" with its trigger):

- **Stencil state** (`stencilFront`, `stencilBack`, `stencilReadMask`, `stencilWriteMask`, `stencil*Op`) — no consumer yet; outlines and shadow-volume techniques are post-MVP.
- **Depth bias** (`depthBias`, `depthBiasSlopeScale`, `depthBiasClamp`) — shadow mapping (Phase 10.4) is the first consumer.
- **Per-camera depth attachment owned by the engine** — today the playground showcase manages its own depth texture and runs a custom render-graph node. The "MainPassNode opens a pass with depth attachment automatically" extension is deferred until a built-in 3D pipeline (Phase 7 / Phase 10) asks for it.

## Decision

1. **Add `DepthStencilState` to `RenderPipelineDescriptor.depthStencil?`.** Optional; omit for color-only pipelines (unchanged default). Fields:
   - `format: TextureFormat` — must match the active render pass's depth attachment view format.
   - `depthWriteEnabled?: boolean` — default `true`.
   - `depthCompare?: CompareFunction` — default `'less'`.

2. **Add `CompareFunction`** — string union mirroring WebGPU's `GPUCompareFunction`: `'never' | 'less' | 'equal' | 'less-equal' | 'greater' | 'not-equal' | 'greater-equal' | 'always'`. Exported from `renderer-core/index`.

3. **Add `DepthStencilAttachment` to `RenderPassDescriptor.depthStencilAttachment?`.** Optional. Fields:
   - `view: TextureView`.
   - `depthLoadOp: 'load' | 'clear'`.
   - `depthStoreOp: 'store' | 'discard'`.
   - `depthClearValue?: number` — default `1.0` (per WebGPU convention).
   - `depthReadOnly?: boolean`.

4. **Extend `PrimitiveState` with `cullMode?: CullMode` and `frontFace?: FrontFace`.** Defaults: `cullMode: 'none'`, `frontFace: 'ccw'` (no behaviour change for existing consumers).

5. **`CullMode = 'none' | 'front' | 'back'`** and **`FrontFace = 'ccw' | 'cw'`** — string unions, WebGPU-compatible values pass through unmodified.

6. **WebGPU backend (`renderer-webgpu`) implements all of the above.** Translation lives in two places:
   - `pipeline.ts` — `createRenderPipelineImpl` reads `depthStencil`, `primitive.cullMode`, and `primitive.frontFace`, populates `GPUPrimitiveState` and `GPUDepthStencilState`. Defaults applied at translation time so the GPU descriptor is always fully-specified.
   - `encoder.ts` — `beginRenderPass` reads `depthStencilAttachment` and builds `GPURenderPassDepthStencilAttachment`.

7. **WebGL2 stub (`renderer-webgl2`) needs no change.** The new fields are all optional on existing methods; the stub's throwing factories cover them by virtue of throwing on every call.

8. **No automatic depth attachment management on `Camera` / `MainPassNode`.** Today's consumer (the playground showcase) registers its own render-graph sub-graph and manages its own depth texture. When a built-in 3D pipeline ships, the engine grows `Camera.depthTarget` and `MainPassNode` learns to open the pass with a depth attachment — that is its own ADR.

Composition-only. No abstract pipeline / pass base classes were added; both descriptor types gained optional fields. The change is purely additive to the HAL surface.

## Consequences

**Easier:**

- The Phase 6 playground showcase (`primitives-showcase-plugin.ts`) renders all 15 primitives correctly with depth + back-face culling — the first end-to-end visual verification of `Mesh` + `RenderMesh` + `MeshAllocator` + the HAL vertex/index path.
- Phase 7's `Material<M>` plugins build their pipelines with `depthStencil` + `cullMode` from day 1 (the typical "opaque mesh with depth test + back-face cull" pipeline is one descriptor literal away).
- Phase 10's `prepareDepthPrepass` / shadow-map pipelines have the descriptor surface they need; shadow-bias lands as an additive change to `DepthStencilState` when it's needed.
- The render-graph node author who needs a depth attachment writes a `beginRenderPass` call with a `depthStencilAttachment` field — no new node-context plumbing required.

**Harder / accepted trade-offs:**

- **Two related-but-separate concerns ship in one ADR.** Depth-stencil state and primitive cull/front-face state are conceptually different (one is a pass-level concern, the other a pipeline-level concern). Bundling them keeps the ADR cost low for changes that share a consumer; the cost is that searching for "cull mode" in the ADR index doesn't surface an obvious named ADR.
- **Default `cullMode: 'none'` preserves backward compatibility but is wrong for most 3D meshes.** A consumer who forgets to opt into `'back'` cull gets a pipeline that draws every triangle, including back-facing ones — slower, and visually wrong when paired with depth testing. Switching the default to `'back'` is breaking for any consumer that relies on no-cull behaviour for 2D / particle / debug rendering. Phase 7 will document the right default per material.
- **`DepthStencilState.depthWriteEnabled` / `depthCompare` defaults applied at translation, not at descriptor construction.** A consumer who reads back `descriptor.depthStencil.depthWriteEnabled` after passing `undefined` does not see the default — only the WebGPU pipeline does. This is consistent with how the rest of the HAL handles optionals (see `PrimitiveState.topology`).
- **No stencil state surface.** The descriptor is "depth-stencil" by WebGPU name only; today only depth ops are exposed. A stencil-using consumer will need a follow-up ADR that extends `DepthStencilState` with `stencilFront` / `stencilBack` etc., and `DepthStencilAttachment` with `stencilLoadOp` / `stencilStoreOp` etc.

## Not yet done

Each entry below is deferred until its trigger consumer lands.

- **Stencil state on `DepthStencilState`** — outline rendering, shadow-volume techniques.
- **Depth bias on `DepthStencilState`** — shadow mapping in Phase 10.4.
- **`Camera.depthTarget` and `MainPassNode` depth-attachment auto-management** — when a built-in 3D pipeline (Phase 7's `Mesh3d` + `StandardMaterial`) needs it.
- **Stencil load / store ops on `DepthStencilAttachment`** — pairs with stencil state.
- **`depthBias` / `depthBiasSlopeScale` / `depthBiasClamp`** — shadow maps.

## Implementation

- `packages/renderer-core/src/pipeline.ts` — `DepthStencilState`, `CompareFunction`, `CullMode`, `FrontFace`; `RenderPipelineDescriptor.depthStencil?`; `PrimitiveState.cullMode?` / `frontFace?`.
- `packages/renderer-core/src/encoder.ts` — `DepthStencilAttachment`; `RenderPassDescriptor.depthStencilAttachment?`.
- `packages/renderer-core/src/index.ts` — re-exports for the new types.
- `packages/renderer-webgpu/src/pipeline.ts` — `createRenderPipelineImpl` translates `depthStencil`, `primitive.cullMode`, `primitive.frontFace`.
- `packages/renderer-webgpu/src/encoder.ts` — `beginRenderPass` translates `depthStencilAttachment` via `toDepthStencilAttachment` helper.
- `apps/playground/src/primitives-showcase-plugin.ts` — the consumer this ADR ships for. Builds a `depth32float` texture per surface size, registers a custom render sub-graph that opens a color + depth pass, and draws all 15 Phase 6 primitives with `cullMode: 'back'` + `depthCompare: 'less'`.
