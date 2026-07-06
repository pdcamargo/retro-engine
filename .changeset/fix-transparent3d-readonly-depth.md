---
'@retro-engine/renderer-core': patch
'@retro-engine/renderer-webgpu': patch
'@retro-engine/engine': patch
---

fix(renderer): Core3d transparent pass used an invalid read-only depth attachment

The 3D transparent pass (`TransparentPass3dNode`) set `depthReadOnly: true`
together with `depthLoadOp: 'load'` / `depthStoreOp: 'discard'`. WebGPU forbids
setting the load/store ops when `depthReadOnly` is true, so the pass produced an
invalid `CommandBuffer` and dropped every frame that contained a transparent 3D
draw. It went unnoticed because nothing used the 3D transparent phase until
world-space text (ADR-0155) became its first consumer.

- `@retro-engine/renderer-core`: `DepthStencilAttachment.depthLoadOp` /
  `depthStoreOp` are now optional (they are mutually exclusive with
  `depthReadOnly`, per the WebGPU spec).
- `@retro-engine/renderer-webgpu`: the encoder only forwards `depthLoadOp` /
  `depthStoreOp` when set (omitted for a read-only depth attachment).
- `@retro-engine/engine`: `TransparentPass3dNode` builds a read-only depth
  attachment with no load/store ops — the opaque depth still gates transparent
  fragments (pipelines carry `depthWriteEnabled: false`).

Verified in a real browser: world-space 3D text now renders through the 3D
transparent pass with no validation errors and is correctly occluded by nearer
opaque geometry.
