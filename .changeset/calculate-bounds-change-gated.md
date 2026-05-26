---
'@retro-engine/engine': patch
---

fix(engine): change-gate calculateBoundsSystem on Mesh3d

The auto-AABB writer re-derived a local-space `Aabb` for every `Mesh3d` entity
on every frame. `Mesh.computeAabb()` is an O(vertices) walk of the position
buffer, so the cost scaled with both entity count and mesh density — a profile
of a medium stress scene showed `Aabb.fromPoints` dominating the frame (~55% of
main-thread CPU, ~7 ms/frame), capping the frame rate well below the display's
refresh.

A mesh's local-space bounds only move when its geometry does, so the system's
query is now gated on changed `Mesh3d`: an entity is visited on the frame its
`Mesh3d` is added and again only when `Mesh3d` is flagged changed. Steady-state
cost on an idle scene drops ~100× (measured: 1024 entities, 1.11 ms → 10 µs).

**Behaviour change:** editing a `Mesh`'s vertex data in place while keeping the
same handle no longer refreshes bounds on its own, because the gate keys on the
`Mesh3d` component rather than the `Mesh` asset. Signal such an edit by
re-inserting `Mesh3d` on each affected entity (or
`world.markChanged(entity, Mesh3d)`). Spawning, swapping the mesh handle, and
adding `Mesh3d` are unaffected — those already flag the component.
