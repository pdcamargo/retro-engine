---
'@retro-engine/engine': minor
---

feat(engine): `bakeMorphedMesh` — freeze a customized character into a static mesh

Bakes the character creator's current customization into a fresh, morph-free `Mesh` (ADR-0132):
compose the weighted sparse targets onto the pristine base positions, copy the base's UVs + indices,
recompute smooth normals. The result is an ordinary mesh that renders with zero runtime morph cost
and is ready to rig/skin/animate like any other.

The studio's character-creator panel gains a **Bake** button that spawns the baked character as a
standalone entity. Disk persistence (`.rmesh`) and GLB export are deferred
(`docs/backlog/baked-character-persistence.md`) — no GLB exporter exists yet.

Verified live: with morph weights set, Bake produces a new 19,158-vertex mesh whose vertices carry the
composed shape (distinct from the neutral base), and it renders with the renderer healthy. Completes
RetroHuman Phase 3 (character creator + bake).
