---
'@retro-engine/engine': minor
---

feat(engine): retained / change-gated instance preparation (opt-in) — ADR-0039

After GPU instancing (ADR-0038) the `stress-showcase` "large" preset is 100% CPU/main-thread bound: the sprite and mesh prepare pipelines re-collect, re-sort, re-pack, and re-upload every visible instance each frame even though almost nothing moves. This adds a retained path that keeps instance buffers and sorted draw order across frames and rewrites only what changed — a steady-state frame does O(changed) work instead of O(n).

New shared instance primitives under `packages/engine/src/instance/`:

- `RetainedSlotMap` — stable per-entity instance-slot allocator with a length-bucketed free list and compaction.
- `GrowableInstanceStore` — growable GPU buffer + CPU scratch with dirty-range coalescing and partial uploads (full-upload fallback past 50% dirty).
- `RetainedInstanceBuffer` — composes the two.
- `SortedSlotIndex` — retained per-camera draw order that re-sorts only on invalidation (membership / sort-key change / camera move) and copies just the changed bytes when the order is stable.

Opt-in via a `{ retained }` plugin option (default `false`, so behaviour is unchanged):

- `new SpritePlugin({ retained: true })` → `RetainedSpriteBuffer` + `prepareSpritesRetained`.
- `new MaterialPlugin(M, { retained: true })` and `new Material2dPlugin(M, { retained: true })` → `RetainedMeshBuffer` + `prepareMeshRetained`, splitting the per-frame queue into a change-gated prepare and a thin payload-resolving queue.

Change detection uses a self-managed main-world since-tick (render-stage params carry the render world's tick), mirroring `propagateTransformsGated`. Instance bytes are camera-independent and packed only on `Changed<GlobalTransform>` (plus `Changed<Sprite>` / `Changed<Mesh*>` / `Changed<MeshMaterial*>` for grouping). The path stays WebGL2-reachable — no indirect draw, no storage buffers, no new `RendererCapabilities` flag.

**New public surface:** `RetainedSpriteBuffer`. The `{ retained }` options on `SpritePlugin`, `MaterialPlugin`, and `Material2dPlugin`.

**Behaviour changes:** none by default. The retained path is byte-parity with the per-frame path (verified by tests) and is selected only when the option is set.
