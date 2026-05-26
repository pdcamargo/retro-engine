# Retained instance preparation + spatial culling acceleration

- **Created:** 2026-05-26

## Status

- **Item 1 (retained prep): implemented, opt-in, not yet activated.** Sealed by
  [ADR-0039](../adr/ADR-0039-retained-instance-preparation.md). Shipped behind a
  `{ retained }` flag on `SpritePlugin` / `MaterialPlugin` / `Material2dPlugin`
  (default `false`), byte-parity-tested against the per-frame path, with a
  full-rebuild-vs-retained bench. **Pending:** re-trace the "large" preset at
  fullscreen + small window, then flip the defaults and retire the legacy path
  (the trace at capture time was 100% CPU-bound; the re-trace confirms the new
  wall before Item 2).
- **Item 2 (culling): direction confirmed as a spatial grid/BVH** (the scalable,
  moving-camera-ready structure), not the cheaper change-gated cull. Scope
  sealed from the post-Item-1 re-trace in its own ADR.

## Context

After GPU instancing landed (ADR-0038), a Performance trace of the
`stress-showcase` "large" preset showed the GPU-process main thread drop from
~88% to ~27% and frame time fall ~196 ms → ~120 ms. The renderer is no longer
the bottleneck: the main thread is pinned at ~95% and the frame is now **100%
CPU-bound**, dominated by per-frame work that scales linearly with content. Two
quick wins shipped right after that trace — change-gating
`calculateSpriteBoundsSystem` (the 2D twin of the mesh bounds fix) and trimming
`checkVisibilitySystem`'s per-entity `getComponent` calls — but those are
incremental. The two structural costs below are what stand between "large" and
the 165 FPS display cap.

Per-frame attribution from the post-instancing trace (~120 ms frame):

| Bucket | % frame | Note |
|---|---|---|
| Sprite prepare (`sortAndEmitSpriteBatches` + `packSpriteInstance`) | ~24% | rebuilt every frame |
| 3D queue (`packInstancedBatches` + `packInstanceTransform` + `get`) | ~17% | rebuilt every frame |
| 2D queue (`packInstancedBatches`) | ~12% | rebuilt every frame |
| `checkVisibilitySystem` | ~14% | O(entities × cameras), no spatial structure |
| `calculateSpriteBoundsSystem` | ~9% | **addressed** (change-gated) |
| GC | ~6% | per-frame instance/entry allocations |

## Item 1 — Retained / change-gated instance preparation

**Problem.** Every frame, the sprite and mesh queues re-collect every visible
entity, re-sort them, re-pack every instance's transform into a fresh buffer
range, and re-emit every batch — even when nothing moved. This per-frame rebuild
(`sortAndEmitSpriteBatches`, `packInstancedBatches`, `packInstanceTransform`,
`packSpriteInstance`) is ~53% of the "large" frame and scales O(n log n) with
content. It is the same "don't redo work for static content" problem the bounds
change-gating solved, but applied to the whole prepare pipeline.

**Direction (to be sealed by an ADR).** Persist instance buffers and batch lists
across frames; update only the entries whose transform / sprite / material
changed (gate on `Changed<GlobalTransform>` + `Changed<Sprite>` /
`Changed<MeshMaterial*>`), writing just the dirty buffer ranges. Open questions:

- **Stable instance slots.** A retained buffer needs a per-entity slot that
  survives across frames (slot allocator + free list), so a changed entity
  rewrites its slot in place instead of repacking the whole buffer. Despawns
  free slots; spawns allocate.
- **Sort stability.** Opaque (free-grouped) batches tolerate retained order;
  transparent / 2D batches are depth-sorted, and depth changes when the camera
  or entity moves — a moving camera invalidates the sort for everything. Decide
  whether to re-sort only when the camera moved, keep a coarse bucketed order,
  or accept a full re-sort for transparent only.
- **Partial buffer uploads.** The HAL `writeBuffer` already takes an offset;
  dirty-range coalescing vs. per-slot writes is a tuning call.
- **Interaction with multi-camera.** Instances are currently packed per
  `(camera × entity)`; a retained design must decide whether slots are
  per-camera or shared.

This is a meaningful initiative (slot allocation, dirty tracking, incremental
uploads, sort invalidation) — it warrants its own ADR and likely a bench
comparing full-rebuild vs. retained at 0% / 10% / 100% dirty, mirroring
`propagation.bench.ts`.

## Item 2 — Spatial acceleration for `checkVisibilitySystem`

**Problem.** `packages/engine/src/visibility/check-visibility.ts` tests every
renderable against every active camera frustum with no spatial structure —
O(entities × cameras). ~14% of the "large" frame. The per-entity `getComponent`
trim already shipped; the algorithmic cost remains.

**Direction.** Add a spatial acceleration structure (uniform grid or BVH over
world-space AABBs) so the cull visits O(visible + log n) instead of O(n). Open
questions: rebuild-vs-refit cadence for a moving scene, where the structure
lives (resource vs. per-camera), and how it interacts with the aggregate
(non-per-camera) `ViewVisibility` the engine currently writes. Independent of
Item 1; can land in either order.

## Acceptance

- An ADR seals the retained-prep design (slot allocation, dirty tracking, sort
  invalidation, buffer-upload strategy) with an `## Implementation` section.
- The sprite + mesh queues skip repacking unchanged instances: a steady-state
  frame (camera and entities static) does O(changed) prepare work, not O(n) —
  verifiable in a trace and a bench.
- `checkVisibilitySystem` uses a spatial structure: a static-scene cull is
  sublinear in entity count — verifiable in a bench.
- The `stress-showcase` "large" preset reaches the display refresh cap
  (target: 165 FPS) on the author's machine.
- Lint / typecheck / test / build / bench green; visual + correctness parity
  with the per-frame-rebuild path (transforms, alpha ordering, cull results).
