# ADR-0029: HAL stencil + depth-bias + blend extensions

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

ADR-0026 added the depth-side of the HAL and explicitly deferred three slices to the first consumer that needed them: stencil state on `DepthStencilState`, stencil load/store ops on `DepthStencilAttachment`, and depth-bias fields on `DepthStencilState`. It also noted that `ColorTargetState` had no blend surface — every fragment target wrote with the WebGPU default `(src*one + dst*zero)` and `writeMask=0xF`, which is exactly opaque rendering. Transparent rendering, masked-write attachments, and additive-blend particles all wait on a real blend surface.

Phase 7's `Material` system is that consumer. `StandardMaterial` ships with `alpha_mode: 'opaque' | { kind: 'mask'; cutoff } | 'blend'`; the `'blend'` variant configures a back-to-front transparent pipeline that writes color but not depth — that needs blend state. `StandardMaterial.depth_bias` configures Phase 10.4 shadow-map pipelines — that needs depth-bias. Outline and shadow-volume techniques will want stencil; even though Phase 7 doesn't ship outlines, sealing the stencil HAL alongside the rest avoids a third HAL ADR three weeks from now.

ADR-0024 set the precedent: HAL extensions ride with the consumer that needs them, rather than landing speculatively. ADR-0026 followed the same pattern. This ADR bundles three related extensions (stencil, depth-bias, blend) because they all land in the same Phase 7 slice and share a single backend translation patch — splitting them across three ADRs would be ceremony without benefit.

Out of scope for this ADR (each documented in §"Not yet done" with its trigger):

- **Camera.depthTarget` and `MainPassNode` depth-attachment auto-management** — owned by ADR-0028, which is the consumer ADR for the materials work.
- **Dual-source blending** — `'src1' / 'one-minus-src1'` blend factors. WebGPU exposes them behind a feature flag; no in-tree consumer yet.
- **Independent per-target blend / writeMask in multi-target fragment shaders** — supported by the additive shape (each `ColorTargetState` carries its own optional fields), but Phase 7 only uses single-target fragment outputs in practice.

## Decision

1. **Add `StencilOperation` and `StencilFaceState` to `renderer-core`.** Both mirror WebGPU's `GPUStencilOperation` / `GPUStencilFaceState` shapes. Fields:
   - `StencilOperation`: `'keep' | 'zero' | 'replace' | 'invert' | 'increment-clamp' | 'decrement-clamp' | 'increment-wrap' | 'decrement-wrap'`.
   - `StencilFaceState`: `compare?` (default `'always'`), `failOp?` (default `'keep'`), `depthFailOp?` (default `'keep'`), `passOp?` (default `'keep'`). All four default to "no-op stencil" — a face state with no fields set is observably identical to omitting it.

2. **Extend `DepthStencilState` with stencil + depth-bias fields.** All optional, all WebGPU-defaulted at translation time:
   - `stencilFront?: StencilFaceState` (default: all no-op).
   - `stencilBack?:  StencilFaceState` (default: all no-op).
   - `stencilReadMask?:  number` (u32, default `0xFFFFFFFF`).
   - `stencilWriteMask?: number` (u32, default `0xFFFFFFFF`).
   - `depthBias?:           number` (i32, default `0`).
   - `depthBiasSlopeScale?: number` (f32, default `0`).
   - `depthBiasClamp?:      number` (f32, default `0`).

3. **Add blend state to `ColorTargetState`.** New types and one extension:
   - `BlendOperation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max'`.
   - `BlendFactor` — string union mirroring `GPUBlendFactor`, all eleven values that WebGPU exposes without feature gates (no `'src1' / 'one-minus-src1' / 'src1-alpha' / 'one-minus-src1-alpha'`).
   - `BlendComponent`: `operation?` (default `'add'`), `srcFactor?` (default `'one'`), `dstFactor?` (default `'zero'`). The default triple is "no blend" — observably identical to omitting blend.
   - `BlendState`: `{ color: BlendComponent; alpha: BlendComponent }`. Both halves required when blend is set; the WebGPU descriptor demands both.
   - `ColorWrite` const + `ColorWriteFlags` type — bitfield mirroring `GPUColorWrite` (`RED=0x1`, `GREEN=0x2`, `BLUE=0x4`, `ALPHA=0x8`, `ALL=0xF`).
   - `ColorTargetState.blend?: BlendState` (default: omitted → "no blend").
   - `ColorTargetState.writeMask?: ColorWriteFlags` (default `0xF` — all channels).

4. **Extend `DepthStencilAttachment` with stencil load/store + readOnly.** All optional. Existing `depthLoadOp` / `depthStoreOp` remain required (depth aspect is the common case; depth-less stencil-only attachments are not a Phase 7 concern).
   - `stencilClearValue?: number` (u32, default `0`).
   - `stencilLoadOp?:  'load' | 'clear'`.
   - `stencilStoreOp?: 'store' | 'discard'`.
   - `stencilReadOnly?: boolean`.

5. **Add `setStencilReference(reference: number): void` to `RenderPassEncoder`.** Sets the dynamic stencil reference value compared against by `StencilFaceState.compare`. Mirrors `GPURenderPassEncoder.setStencilReference`.

6. **WebGPU backend (`renderer-webgpu`) implements all of the above.** Translation in two places:
   - `pipeline.ts` — `createRenderPipelineImpl` expands every new `DepthStencilState` field with its default value, expands `StencilFaceState` to a fully-specified record, translates per-target `blend` and `writeMask`. Defaults applied at translation time so the GPU descriptor is always fully-specified, matching the ADR-0026 pattern.
   - `encoder.ts` — `toDepthStencilAttachment` translates the stencil load/store ops; `makeRenderPassEncoder` gains a `setStencilReference` method that forwards to the underlying `GPURenderPassEncoder`.

7. **WebGL2 stub (`renderer-webgl2`) needs no change.** Every new HAL field is optional on existing methods; the new `setStencilReference` method joins the encoder interface and will throw alongside the other unsupported methods when a WebGL2 backend ships.

8. **No new capability flag.** Stencil, depth-bias, and blend are all WebGPU baseline — no adapter feature is required. The existing `RendererCapabilities` interface is unchanged.

Composition-only. The change is purely additive: optional fields on existing descriptors and one new method on `RenderPassEncoder`. No existing call site needs to change.

## Consequences

**Easier:**

- Phase 7's `MaterialPlugin<M>` builds pipelines with full depth-stencil + blend + cull configuration from one descriptor — no second-pass "patch the pipeline with blend state" plumbing.
- Phase 7's `Transparent3d` phase node opens its render pass with `depthLoadOp: 'load'` and configures pipelines with `depthWriteEnabled: false` + `BlendState.color = { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }` — the canonical premultiplied-alpha back-to-front transparent path.
- Phase 10.4's shadow-map pipelines configure `depthBias` / `depthBiasSlopeScale` / `depthBiasClamp` directly on `DepthStencilState` — no follow-up HAL ADR.
- Outline / shadow-volume techniques (post-Phase-7) configure `StencilFaceState` on the same descriptor without any further HAL change.

**Harder / accepted trade-offs:**

- **`StencilFaceState`'s four fields all default to no-op, which is semantically right but verbose to validate.** A consumer who sets `stencilFront: { compare: 'equal' }` and forgets to set `passOp` gets WebGPU's `'keep'` default — observably "stencil reads but never writes." That's the intended escape hatch (write-only stencil pre-passes use `compare: 'always'` + `passOp: 'replace'`; read-only material-pass uses `compare: 'equal'` + the three op fields left default). Documented in TSDoc.
- **`BlendState` requires both `color` and `alpha` halves.** WebGPU's `GPUBlendState` has no shorthand for "same blend for both." A consumer who wants standard alpha blending writes the same component twice. Could be helper-eased later, not in this ADR.
- **`depthBias` is an integer and `depthBiasSlopeScale` / `depthBiasClamp` are floats.** Mirrors the WebGPU split. Easy to flip one for the other by accident — TSDoc calls it out explicitly.
- **`writeMask` is a bitfield, not a `Set<'r'|'g'|'b'|'a'>`.** Matches WebGPU and matches `ShaderStage` (also a bitfield). A masked-write consumer writes `ColorWrite.RED | ColorWrite.ALPHA`; the value `0` is "no writes." Type-level type for `0` (forbidding the always-discard case) is not enforced — the cost of guard types here isn't worth the rare opt-in.
- **No `ColorWrite.RGB` shorthand.** A consumer who wants RGB-only writes `ColorWrite.RED | ColorWrite.GREEN | ColorWrite.BLUE`. Adding a shorthand is one line; not now.

## Not yet done

Each entry below is deferred until its trigger consumer lands.

- **Dual-source blending** (`'src1'`, `'one-minus-src1'`, `'src1-alpha'`, `'one-minus-src1-alpha'` blend factors). Behind a WebGPU feature flag; no consumer asks for it today. Lands with the first consumer (subsurface scattering / decals) plus a `RendererCapabilities.dualSourceBlending` flag.
- **`Camera.depthTarget` and per-camera depth allocation** — owned by ADR-0028 (the consumer ADR).
- **Stencil-only attachments** (a depth-stencil view with no depth aspect). Phase 7 doesn't need them; the existing `depthLoadOp` / `depthStoreOp` stay required.
- **Per-target blend ergonomics helpers** (`BlendState.standard`, `BlendState.additive`, etc.). Not now — the canonical-blend triples are short enough to type, and helpers risk drifting from WebGPU's literal values.

## Implementation

- `packages/renderer-core/src/pipeline.ts` — `StencilOperation`, `StencilFaceState`, `BlendOperation`, `BlendFactor`, `BlendComponent`, `BlendState`, `ColorWrite`, `ColorWriteFlags`; new fields on `DepthStencilState`; new fields on `ColorTargetState`.
- `packages/renderer-core/src/encoder.ts` — new stencil fields on `DepthStencilAttachment`; new `setStencilReference` on `RenderPassEncoder`.
- `packages/renderer-core/src/index.ts` — re-exports for the new types and the `ColorWrite` runtime constant.
- `packages/renderer-webgpu/src/pipeline.ts` — `createRenderPipelineImpl` translates the new `DepthStencilState` fields (with `StencilFaceState` defaults expanded) and the new per-target `blend` / `writeMask` fields. Defaults applied at translation time.
- `packages/renderer-webgpu/src/encoder.ts` — `toDepthStencilAttachment` translates stencil load/store + `stencilClearValue` + `stencilReadOnly`; `makeRenderPassEncoder` adds `setStencilReference`.
- `packages/renderer-core/src/pipeline.test.ts` — structural-shape tests for the new types (default expansion, blend-state shape, write-mask bitfield round-trip).
- `packages/renderer-core/src/encoder.test.ts` — structural-shape tests for the new attachment fields.
