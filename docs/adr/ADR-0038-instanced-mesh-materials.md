# ADR-0038: GPU-instanced 3D / 2D mesh-material rendering

- **Status:** Accepted
- **Date:** 2026-05-26

## Context

ADR-0028 shipped the 3D material system and ADR-0035 the 2D one. Both bind a
per-entity `@group(1)` uniform (model + inverse-transpose, 128 bytes) via a
shared `EntityTransformGpuCache`, and emit **one draw call per visible entity**:
one `writeBuffer`, one bind group, one `drawIndexed(..., 1, ...)` each. ADR-0036
already gave sprites GPU instancing (one instance buffer, one instanced draw per
batch) and they are cheap.

A Performance trace of the `stress-showcase` "large" preset (~5–10 FPS) showed
the renderer main thread **and** the GPU-process main thread both pinned at
~88%, a ~196 ms/frame JS callback, ~30% of CPU in raw WebGPU command submission
(`setBindGroup` / `writeBuffer` / `drawIndexed`), and ~6.6% GC from per-entity
draw-closure allocations. The cost is O(entities): the mesh-material path never
adopted the instancing sprites already proved out. This ADR closes that gap.

## Decision

1. **Per-instance transforms ride in vertex attributes**, not a per-entity
   uniform. A growable instance buffer (`MeshInstanceBuffer`, one per
   `MaterialPlugin<M>` / `Material2dPlugin<M>`, mirroring `SpriteInstanceBuffer`)
   is packed once per frame and bound at vertex slot 1 with `stepMode:
   'instance'`. Each instance is 128 bytes: the `model` matrix at
   `@location(8..11)`, its inverse-transpose at `@location(12..15)`. Vertex
   attributes (not a storage buffer) keep the path WebGL2-reachable
   (`vertexAttribDivisor`); no `RendererCapabilities` flag is needed. Base
   location 8 leaves mesh vertex attributes (`0..N-1`, N ≤ 5) collision-free
   within the 16-attribute floor.

2. **Bind groups are renumbered:** `@group(0)` view, `@group(1)` material. The
   per-entity transform group and `EntityTransformGpuCache` are deleted; pipeline
   layouts shrink to `[viewLayout, materialBindGroupLayout]`.

3. **All draws are instanced** — a lone entity is a batch of one. Renderables are
   grouped by `(camera, alpha bucket, mesh, material)`; each batch emits one
   `drawIndexed(indexCount, count, baseIndex, baseVertex, firstInstance)` and one
   `PhaseItem`. Opaque / alpha-mask 3D batches group freely (the depth buffer
   resolves order); transparent 3D and **all** 2D buckets (no depth buffer) are
   depth-sorted first and only merge adjacent same-key runs, preserving draw
   order. The sort/walk/pack is shared by both plugins (`packInstancedBatches`).

## Consequences

- **Easier:** N copies of a mesh collapse from N draws + N buffer uploads to
  O(batches). The render-encoding, transform-upload, and per-entity-closure GC
  costs that dominated the "large" trace all drop with batch count. The 3D and 2D
  queues now share their batching and draw-closure code.
- **Harder / accepted trade-offs:**
  - **Breaking change for custom material WGSL:** material resource bindings move
    `@group(2)` → `@group(1)`; a fully custom vertex shader must read the model
    matrix from `@location(8..15)` instead of the old uniform. Built-in materials
    are migrated here; documented in the changeset.
  - Transparent / 2D instancing is opportunistic — only depth-adjacent same-key
    runs merge, so heavily interleaved transparent scenes batch less. This is the
    inherent limit of order-dependent instancing (same as sprites).
  - Every instance uploads 128 bytes even for unlit materials, which ignore the
    inverse-transpose half. Packing it as a 3×3 normal matrix or reconstructing
    in-shader is a deferred bandwidth optimization.

## Implementation

- `packages/engine/src/material/instance-layout.ts` — `INSTANCE_LAYOUT`,
  `INSTANCE_TRANSFORM_BASE_LOCATION`, `MESH_INSTANCE_BYTE_SIZE`,
  `MESH_INSTANCE_FLOAT_COUNT`, `packInstanceTransform`
- `packages/engine/src/material/mesh-instance-buffer.ts` — `MeshInstanceBuffer`
- `packages/engine/src/material/instance-batching.ts` — `AlphaBucket`,
  `InstanceEntry`, `InstancedBatch`, `InstancedDrawPayload`,
  `packInstancedBatches`, `makeInstancedDraw`
- `packages/engine/src/material/material-plugin.ts` — `MaterialPlugin` (instanced
  `queueMaterials`, `specialize` → layout `[view, material]`)
- `packages/engine/src/material2d/material-2d-plugin.ts` — `Material2dPlugin`
  (same, all buckets depth-ordered)
- `packages/engine/src/material/unlit.wgsl.ts`,
  `packages/engine/src/material/pbr.wgsl.ts`,
  `packages/engine/src/material2d/color-material-2d.wgsl.ts` — instance-attribute
  vertex inputs + `@group(1)` material bindings
- Removed: `packages/engine/src/material/mesh-3d-transforms.ts`,
  `packages/engine/src/material/gc-entity-transforms.ts`
