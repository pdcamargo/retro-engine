---
'@retro-engine/engine': minor
---

feat(engine): event-driven visibility cull + retained prepares — ADR-0040

ADR-0039 made the retained prepares pack and sort in O(changed), but left two per-frame O(n) base walks a static-but-visible entity still paid every frame: `checkVisibilitySystem` rewrote `ViewVisibility` for every renderable, and each retained prepare walked its whole visible set to detect spawns/despawns/visibility-flips. Both are now event-driven.

- `checkVisibilitySystem` is change-gated: with an unchanged active-camera set it recomputes only entities whose own inputs changed (`Changed<GlobalTransform | Aabb | InheritedVisibility | RenderLayers>` + removed `Aabb`/`NoFrustumCulling`); any camera move/projection/add/remove (detected by a frustum + layer-mask snapshot compare) forces a full recompute identical to a per-frame walk. It now stamps `Changed<ViewVisibility>` only on a real flip, making visibility edges observable.
- The retained sprite/mesh prepares maintain their slot set from those change events plus the removed buffer — no per-frame structural walk. A small pending set re-checks entities whose asset hasn't uploaded yet. The mesh prepare applies per-camera add/update/remove deltas and recomputes depth only when a camera's view matrix changed.

This is the new implementation of the existing `{ retained: true }` plugin option (no new flag); the legacy full-repack path (`{ retained: false }`) stays as the fallback and parity reference. A static scene now does O(changed) cull + prepare work — bench shows the event-driven static frame ~7–9× faster than the legacy walk for meshes and ~2.3× for sprites, with far less per-frame allocation.
