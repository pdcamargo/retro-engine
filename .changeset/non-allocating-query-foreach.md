---
'@retro-engine/ecs': minor
'@retro-engine/engine': patch
---

perf(ecs): non-allocating Query.forEach for hot-path iteration

`Query.entries()` / the row iterator allocate a fresh `[entity, ...components]`
tuple per row and run through a generator — and a profile of the stress preset
showed that per-frame query iteration, not the render prepare, had become the
dominant cost once retained prep (ADR-0039) landed (systems that touch every
entity each frame allocate ~one tuple per entity per query).

Adds `Query.forEach(cb)` (backed by `World.forEachEntry`) that reuses a single
row buffer across all rows and invokes the callback directly — no per-row array,
no generator. Bench: **~4–6× faster** than `.entries()` iterating 100k entities
(entity + 3 components). The row passed to the callback is transient — read it
in the callback, don't retain it; `.entries()` stays for the retain-safe /
collect case and is unchanged.

The engine's per-frame O(n) loops migrate to it (no behavior change, parity
tests green): the visibility cull, the retained sprite + 3D/2D mesh prepare base
walks, and the atlas animation ticker. Also factors the shared archetype-match
test out of the two existing query iterators.

**New public surface:** `Query.forEach`.
