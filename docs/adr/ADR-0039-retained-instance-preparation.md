# ADR-0039: Retained / change-gated instance preparation

- **Status:** Accepted
- **Date:** 2026-05-26

## Context

ADR-0038 gave the mesh-material path GPU instancing, dropping the
`stress-showcase` "large" preset from a GPU-and-CPU-pinned ~196 ms/frame to
~104 ms/frame. A follow-up Performance trace of that preset showed the frame is
now **100% CPU / main-thread bound** (renderer-main RunTask busy ≈ span; the
GPU-process main thread idles at ~28%). The dominant costs all rebuild from
scratch every frame and scale O(n) with content:

- 3D + 2D mesh queue (`packInstancedBatches` + `packInstanceTransform`) ≈ 34%
- sprite prepare (`sortAndEmitSpriteBatches` + `packSpriteInstance`) ≈ 24%
- per-frame instance/entry allocation GC ≈ 4.5%

The "large" preset is ~97.5% static: 100k entities, no transform mutations, a
static camera, no spawns/despawns after startup; only animated sprites mutate
(their atlas index, surfacing as `Changed<Sprite>`). So the prepare pipeline
re-collects, re-sorts, re-packs, and re-uploads ~100k instances every frame to
reflect a few thousand UV edits. The instance bytes (`model` + inverse-transpose
for meshes; world-space affine + UV + tint for sprites) depend only on the
entity's own data, never on the camera — only the **sort order** and per-batch
sort depth are camera-dependent.

One hard constraint shapes the dirty-tracking mechanism: prepare/queue run
against the render world, but change ticks (`markChanged`, `Changed<T>`) live in
the main world. A render-stage system's `Extract(Query([T], { changed: [T] }))`
would compare main-world component ticks against the render world's tick — a
silent mismatch. (`packages/engine/src/system-param.ts` documents this sharp
edge.)

## Decision

Persist instance buffers and sorted draw order across frames; rewrite only what
changed.

1. **Stable per-entity slots.** A `RetainedSlotMap` (allocator + length-bucketed
   free list) hands each entity a contiguous instance run that survives across
   frames; despawns free the run, spawns allocate, holes are recycled by exact
   length, and a fragmentation threshold triggers a compacting repack. A
   `GrowableInstanceStore` owns the CPU scratch (the pack target) and, when the
   buffer is drawn directly, a growable GPU buffer with dirty-range coalescing
   and partial uploads. `RetainedInstanceBuffer` composes the two.

2. **Camera-independent bytes, packed on change only.** An entity's instance
   bytes are packed into its slot once, gated on `Changed<GlobalTransform>`
   (plus `Changed<Sprite>` for sprites — atlas UV edits surface there — and
   `Changed<Mesh*>` / `Changed<MeshMaterial*>` for meshes, which change the
   batch grouping, not the bytes).

3. **Retained draw order.** A `SortedSlotIndex` keeps a sorted member list and
   the ordered GPU buffer the draws read. It re-sorts and rebuilds (a byte
   memcpy from the slot buffer — never a re-pack) **only** on invalidation:
   membership change, a member's sort key change, or a camera move (which
   recomputes camera-space depths). When the order is stable, a data-only change
   copies just that member's bytes into its fixed ordered position. Free-grouped
   opaque/alpha-mask 3D (no depth order) never re-sorts. Sprites sort by
   camera-independent world Z, so a camera move never re-sorts them; meshes keep
   one ordered buffer per camera for the depth-ordered buckets.

4. **Self-managed main-world since-tick.** The retained prepare reads
   `app.world.changeTick` and builds its changed queries explicitly against the
   main world with its own watermark, advancing it once per frame — the
   established `propagateTransformsGated` pattern, not the `Query` change-filter
   param. The "nothing changed" fast path is an in-body early-out, not a
   `runIf`.

5. **WebGL2-reachable.** No reliance on indirect draw or storage buffers; the
   ordered buffer is a plain vertex buffer and the draws are unchanged from
   ADR-0038. No new `RendererCapabilities` flag.

6. **Opt-in during rollout.** Each plugin takes a `{ retained }` flag (default
   `false`); the global default flip and retirement of the legacy per-frame
   path are gated on a re-trace of the "large" preset.

## Consequences

- A steady-state frame does **O(changed)** prepare work: the sprite/mesh queue
  no longer re-sorts or re-packs unchanged instances, and uploads only the dirty
  byte ranges. Verified by bench (`retained @ 0% dirty` is orders of magnitude
  cheaper than the full rebuild; ~3.5× cheaper at 10% dirty) and by a parity
  test asserting a one-sprite tint edit uploads exactly one instance.
- **Trade-off accepted:** at ~100% dirty (every entity changing every frame) the
  incremental path's per-instance bookkeeping (slot copy + dirty-range sort)
  costs more than a single full repack. The design optimizes the sparse-change
  common case; a scene that mutates everything every frame cannot reach the
  display cap regardless and is not the target.
- An entity visible to multiple same-space cameras gets one slot's bytes but a
  draw per camera — strictly better than ADR-0038's per-(camera × entity) pack,
  no worse for the common single-camera case.
- The **O(n) structural scan** (walking the visible set each frame to detect
  spawns / despawns / visibility flips, since aggregate `ViewVisibility` is a
  direct field write and carries no change tick) remains. It is cheap (a map
  probe per entity) but linear; making it sublinear (e.g. an archetype-level
  max-changed-tick skip) is left to a follow-up once a re-trace confirms it is
  the next wall.
- Correctness parity with the per-frame path (packed bytes, alpha ordering,
  batch boundaries, cull results) is covered by byte-exact and draw-call parity
  tests for both sprite and mesh paths.
- The cross-world change-tick mismatch is worked around per-system; fixing it at
  the ECS level so `Extract` + `Changed<T>` "just works" would simplify every
  future render-side change-gate and is a candidate follow-up ADR.

## Implementation

- `packages/engine/src/instance/retained-slot-map.ts` — `RetainedSlotMap`, `Slot`, `SlotMoveVisitor`
- `packages/engine/src/instance/growable-instance-store.ts` — `GrowableInstanceStore`
- `packages/engine/src/instance/retained-instance-buffer.ts` — `RetainedInstanceBuffer`
- `packages/engine/src/instance/retained-draw-order.ts` — `SortedSlotIndex`, `OrderedBatch`
- `packages/engine/src/sprite/sprite-prepare-retained.ts` — `RetainedSpriteBuffer`, `prepareSpritesRetained`, `queueSpritesRetained`
- `packages/engine/src/sprite/sprite-plugin.ts` — `SpritePlugin` `{ retained }` option
- `packages/engine/src/material/mesh-prepare-retained.ts` — `RetainedMeshBuffer`, `MeshKey`, `prepareMeshRetained`
- `packages/engine/src/material/material-plugin.ts` — `MaterialPlugin` `{ retained }` option, `queueMaterialsRetained`
- `packages/engine/src/material2d/material-2d-plugin.ts` — `Material2dPlugin` `{ retained }` option, `queueMaterialsRetained`
