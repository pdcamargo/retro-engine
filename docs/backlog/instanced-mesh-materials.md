# GPU-instanced 3D / 2D mesh-material rendering

- **Created:** 2026-05-26
- **Status:** Implemented (sealed by ADR-0038), pending stress-showcase "large"
  verification. The `checkVisibilitySystem` acceleration (Out of scope below)
  remains open.

## Context

The `stress-showcase` harness at "large" size runs at ~5–10 FPS. A Performance-tab
trace (medium was CPU-bound on the now-fixed `calculateBoundsSystem`; large is a
different signature) shows both the renderer main thread **and** the GPU-process
main thread pinned at ~88%, with a ~196 ms median per-frame JS callback. The cost
is not one hot function — it is spread across the render path because **every
visible 3D and 2D mesh-material entity is submitted individually**.

Per-frame attribution from the trace (≈196 ms frame):

| Bucket | % frame | Note |
|---|---|---|
| `renderFrame` total | ~70% | |
| ├ 3D `queueMaterials` prep | 16.6% | per-entity `ensureEntityTransform` → 1 `writeBuffer`/entity (8.8%) |
| ├ sprite prep | 11.6% | already instanced — not the problem |
| ├ 2D `queueMaterials` prep | 7.4% | same per-entity pattern as 3D |
| └ pass encoding | 33% | per-draw `setBindGroup` + `drawIndexed(count=1)`, one per entity |
| `checkVisibilitySystem` | 15% | tracked separately — see Out of scope |
| GC | 6.6% | per-entity draw-closure + phase-item allocations each frame |

### Why it's slow today

Each visible mesh entity costs, per frame:

- **One uniform buffer + one bind group + one `writeBuffer`** — `packages/engine/src/material/mesh-3d-transforms.ts` `ensureEntityTransform` allocates a 128-byte per-entity uniform (model matrix + inverse-transpose) and uploads it with its own `writeBuffer`. Cached per entity, GC'd when invisible.
- **One draw closure + one `PhaseItem3d`** — `packages/engine/src/material/material-plugin.ts` `queueMaterials` builds a fresh closure and phase item per entity each frame (the GC source).
- **One draw call** — `material-plugin.ts` `makeDrawClosure` → `drawIndexed(indexCount, 1, …)`; instanceCount is hardcoded to `1`. `render-graph/opaque-pass-3d-node.ts` then executes one closure per phase item.

`Material2dPlugin` (`packages/engine/src/material2d/material-2d-plugin.ts`) repeats the
identical per-entity pattern.

So N mesh entities ⟹ N buffers + N bind groups + N buffer uploads + N draws + N
bind-group switches. Both the encoder (renderer main) and the validator (GPU
process) saturate on raw command count.

### The blueprint already exists

The **sprite** path already solved exactly this and is cheap in the same trace:

- `packages/engine/src/sprite/sprite-plugin.ts` packs every sprite's per-instance
  data into one shared instance buffer and uploads it with a **single**
  `writeBuffer`, then issues **one** `drawIndexed(6, count, 0, 0, firstInstance)`
  per `(image, alpha-bucket)` batch — GPU instancing via a `stepMode: 'instance'`
  vertex buffer (`packages/engine/src/sprite/sprite-batch.ts`).

Instanced drawing is a baseline capability (WebGPU core; WebGL2 via
`drawElementsInstanced`) — it needs no `RendererCapabilities` flag, and the
renderer-core contract already exposes the instanced draw path the sprite
pipeline uses. The 3D/2D mesh path simply never adopted it.

## Approach (target — sealed by the implementation plan / ADR)

Mirror the sprite pipeline for mesh materials:

1. Group renderable rows by `(renderMesh, material/pipeline, view, alpha-bucket)`.
2. Pack each instance's transform (model + inverse-transpose, or a compressed
   form) into one shared, growable instance buffer per group; one `writeBuffer`
   per frame instead of one per entity.
3. Move the transform from the per-entity `@group(1)` uniform to per-instance
   vertex attributes (`stepMode: 'instance'`), read via `@builtin(instance_index)`
   — the same shape sprites use. Material bind group stays per group.
4. Emit one instanced `drawIndexed(indexCount, instanceCount, …)` per group;
   collapse `PhaseItem` allocation to per-group so GC churn drops with it.
5. Preserve correct opaque/alpha-mask/blend ordering — transparent instances may
   need per-instance depth sort within a batch (sprites already sort by Z).

Open design questions the plan/ADR must answer: transparent-sort granularity
under instancing, per-instance data layout (full inverse-transpose vs.
reconstruct in shader), how non-instanceable materials fall back, and how this
interacts with the existing `EntityTransformGpuCache` (retire vs. repurpose).

## Out of scope (separate items)

- **`checkVisibilitySystem` acceleration (~15% of the large frame).** O(entities ×
  cameras) linear scan with no spatial structure (`packages/engine/src/visibility/check-visibility.ts`),
  plus 3–4 `world.getComponent` calls per entity. Spatial acceleration (grid/BVH)
  and folding the component lookups into the query row are a distinct follow-up.
- **Sprite path** — already instanced; no change needed.

## Acceptance

- An ADR seals the instanced mesh-material architecture (per-instance data
  layout, batch key, transparent ordering, fallback path) and lists its
  `## Implementation` files/symbols.
- 3D **and** 2D mesh-material draws are instanced: a scene of N identical-mesh
  entities issues O(batches) draws and O(batches) `writeBuffer` calls per frame,
  not O(N) — verifiable in a trace and/or a draw-call counter.
- A bench under `packages/engine/bench/` covers the instanced queue/encode path
  across entity counts (mirroring `sprite-batch*.bench.ts`), with baselines
  committed.
- The `stress-showcase` "large" preset runs at the display refresh cap (target:
  165 FPS, ideally with headroom to spare) on the author's machine — this is the
  explicit performance target for this item.
- Lint / typecheck / test / build / bench green; correctness parity confirmed
  (instanced output matches per-entity output for transforms, normals, and
  alpha ordering).
