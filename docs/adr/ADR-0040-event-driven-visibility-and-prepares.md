# ADR-0040: Event-driven visibility cull + retained prepares

- **Status:** Accepted
- **Date:** 2026-05-26

## Context

ADR-0039 made the retained sprite/mesh prepares do O(changed) *packing* and
*sorting*, but left two per-frame **O(n) base walks** that a static-but-visible
entity still pays every frame, and which a re-trace of the `stress-showcase`
"large" preset confirmed as the next wall (iteration ≈ 18% of the frame):

1. **`checkVisibilitySystem`** wrote `ViewVisibility.visible` for *every*
   renderable each frame. `ViewVisibility` is a plain field write that bumps no
   change tick, so `Changed<ViewVisibility>` never fired — nothing downstream
   could gate on a visibility edge.
2. **Each retained prepare** walked its entire visible set every frame to detect
   spawns / despawns / visibility-flips (allocating slots, building a `seen`
   set, then sweeping freed slots) — cheap per entity, but linear.

The hard constraint from ADR-0039 still holds: the prepares run against the
render world, but change ticks live in the main world, so they self-manage a
main-world `lastPrepareTick` watermark rather than using `Changed<T>` params.
The cull, by contrast, runs in main-world `postUpdate`, after
`propagateTransformsGated` and `visibilityPropagateSystem` have stamped
`Changed<GlobalTransform>` / `Changed<InheritedVisibility>` — so it can use
normal scheduler-tick `Query(..., { changed })` params directly.

## Decision

Make both the cull and the retained prepares event-driven, so a static scene
does O(changed) instead of O(n).

1. **Change-stamp `ViewVisibility` on flip (always on).** The cull writes
   `view.visible` only when the value actually changes, and stamps
   `markChanged(entity, ViewVisibility)` on that flip. Invisible to the legacy
   queue paths (which read the field, never the tick); it makes
   `Changed<ViewVisibility>` a meaningful spawn/hide/show/cull-edge signal.

2. **Change-gated cull (always on, full-pass fallback).** When the active-camera
   set is unchanged from last frame, the cull recomputes only entities whose own
   inputs changed — the union of `Changed<GlobalTransform> ∪ Changed<Aabb> ∪
   Changed<InheritedVisibility> ∪ Changed<RenderLayers>` plus
   `RemovedComponents(Aabb)` / `RemovedComponents(NoFrustumCulling)`. A camera
   move, projection change, or add/remove is detected by a snapshot compare of
   every active frustum's plane coefficients + layer mask + active count
   (`CheckVisibilityState`); any difference forces a full recompute that frame,
   identical to a per-frame full pass. The full pass is also the cold-start path
   (first frame) and the empty-camera path. The per-entity decision is a shared
   helper so both passes emit identical results — there is one cull, not two.

3. **Event-driven retained membership.** Each prepare maintains its slot set from
   change events alone, keeping the self-managed `lastPrepareTick`. An entity
   holds a slot iff it is alive, carries the path's components, is
   `ViewVisibility.visible`, and its asset (image / mesh + material) is uploaded.
   Transitions: `Changed<ViewVisibility>` drives visibility flips (and
   spawn-into-visible, since the cull flips a fresh entity false→true the same
   frame); the main world's removed buffer — read at the render stage *before*
   it drains at frame end — drives despawn / component-removal frees;
   `Changed<GlobalTransform>` / `Changed<Sprite>` / `Changed<mesh|material>`
   drive byte repacks and regrouping. The per-frame structural walk and slot
   sweep are gone.

4. **Asset-readiness via a small pending set.** An entity that is visible but
   whose asset has not uploaded yet is parked in a `pending` set and re-checked
   each frame until ready (or until it dies / goes invisible). This is the only
   residual non-event walk; it is O(not-yet-ready) and drains to zero once a
   static scene's assets upload.

5. **Mesh per-camera deltas.** The mesh prepare keeps a persistent per-entity
   member-data map and applies per-frame `newlyActive` / `changedActive` /
   `freed` deltas to each camera's ordered index. Depth is recomputed for a
   camera only when its view matrix changed (a direct snapshot compare — depth
   is a function of the world-to-view matrix, so this is exact and also catches
   projection-only changes that leave the camera transform untouched). A camera
   first seen this frame is seeded from the whole member set (O(members), only on
   that frame). A static scene with a static camera touches no members.

6. **Event-driven replaces the walk-based retained path.** This is the new
   implementation of the existing `{ retained: true }` plugin option — no new
   flag. The legacy full-repack path (`{ retained: false }`) stays as the
   conservative fallback and the byte-exact parity reference.

## Consequences

- A static-but-visible scene does **O(changed)** cull + prepare work. Bench
  (`event-driven-cull-prepare`): the event-driven static frame is ~7–9× faster
  than the legacy walk for meshes at 1k/8k and ~2.3× for sprites, with
  per-frame allocation down roughly 70× — and the legacy path scales O(n) while
  event-driven does not. The remaining per-frame cost is render-graph dispatch +
  draw emission, not the cull or prepare.
- The change-gated cull is correct on any camera change by construction: the
  snapshot-compare full-pass branch reproduces the old per-frame walk exactly,
  and is the only path that can ever set an unchanged entity. The dirty-set path
  is a pure optimization over the same computation. Covered by multi-frame cull
  tests pinning each dirty source (transform, hierarchy, layers, removed
  `NoFrustumCulling`) and the camera-move full pass.
- **Limitation accepted:** an asset *unload* while an entity stays visible is not
  re-detected — it is not a `Changed` event on the entity and not a main-world
  component removal. Assets are add-only in practice; if eviction-while-visible
  is ever needed, the asset prepares can publish a dirty-handle set the
  membership step intersects. Documented here, not worked around.
- Parity with the legacy full-repack path (packed bytes, batch boundaries, alpha
  ordering, draw calls) holds across spawn, despawn, visibility flip, transform
  move, atlas UV edit, 9-slice toggle, camera move, hide/show, layer change, and
  `NoFrustumCulling` add/remove. The ADR-0039 parity suite passes unchanged
  against the rewrite.

## Implementation

- `packages/engine/src/visibility/check-visibility.ts` — `checkVisibilitySystem` (change-gated; `evaluateViewVisible` shared decision; snapshot-compare full-pass)
- `packages/engine/src/visibility/cull-state.ts` — `CheckVisibilityState`
- `packages/engine/src/visibility/visibility-plugin.ts` — `VisibilityPlugin` wires the cull's changed/removed params + inserts `CheckVisibilityState`
- `packages/engine/src/sprite/sprite-prepare-retained.ts` — `RetainedSpriteBuffer` (`pending`), `prepareSpritesRetained` (event-driven membership)
- `packages/engine/src/material/mesh-prepare-retained.ts` — `RetainedMeshBuffer` (`members`, `pending`, delta sets, per-camera view-matrix snapshot), `prepareMeshRetained`
- `packages/engine/src/index.ts` — re-exports `CheckVisibilityState`
- `packages/engine/bench/event-driven-cull-prepare.bench.ts` — static-frame cull + prepare bench
