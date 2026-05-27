# Render-pass viewport + scissor (HAL)

`renderer-core`'s `RenderPassEncoder` exposes no `setViewport` / `setScissorRect`. Add them, forwarding to the native `GPURenderPassEncoder` methods in `renderer-webgpu`. Both are WebGL2-reachable (`gl.viewport` / `gl.scissor`), so no capability flag.

```ts
// renderer-core: RenderPassEncoder
setViewport(x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number): void;
setScissorRect(x: number, y: number, width: number, height: number): void;
```

## Why it's deferred (not needed yet)

Surfaced while implementing 3D shadow maps (ADR-0045). The original sketch imagined a single 2D shadow atlas subdivided into per-light *tiles*, which would need viewport/scissor to render each tile into a sub-region. ADR-0045 instead uses a **2D-array depth texture** (one layer per caster) — the more scalable primitive (one bind group, the cascade substrate) and fully expressible with today's HAL. So shadows do **not** depend on this.

## What it unblocks (when a consumer lands)

- **Mixed-resolution shadow tiling** — packing variable-resolution shadow maps into one 2D texture (importance-based), complementary to the array-texture path.
- **Viewport cameras / split-screen** — a camera rendering into a sub-rect of its target (`Camera.viewport` is already modelled on `ExtractedCamera`/`CameraView` but the pass nodes can't yet scope draws to it).
- **UI / inset render regions.**

Pick this up when the first real consumer (viewport cameras or mixed-res shadows) arrives; build it then against that consumer's needs rather than speculatively.
