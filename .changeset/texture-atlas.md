---
'@retro-engine/engine': minor
---

feat(engine): TextureAtlasLayout + TextureAtlas component + atlas-sync + per-sprite frustum culling

Phase 8.2 lands the texture-atlas data path on top of Phase 8.1's sprite pipeline. Per ADR-0032. A new `TextureAtlasLayout` value class carves a source image into normalised-UV sub-rects (either via `TextureAtlasLayout.fromGrid({ tileSize, columns, rows, padding?, offset? })` or a hand-authored `Rect[]` for sparse layouts); a new `TextureAtlas` component pairs an entity with a `(layout, index)`; a new `'atlas-sync'` system in `'postUpdate'` writes `sprite.rect = layout.textures[atlas.index]` once per frame on entities whose `TextureAtlas` changed. The existing sprite-prepare hot path consumes the resulting `rect` verbatim — no pipeline changes.

As a load-bearing side effect, `SpritePlugin` now registers `'sprite-bounds'` in `'postUpdate'` (`after: ['atlas-sync']`), populating `Aabb` for sprite entities so the frustum-cull path that already runs in `checkVisibilitySystem` is finally active for sprites. Closes the per-sprite culling deferral from ADR-0031.

**New public surface:**

- `TextureAtlasLayout` — value class with `size: Vec2` (source-image pixel dimensions) + `textures: Rect[]` (in normalised UV). Static factory `TextureAtlasLayout.fromGrid({ tileSize, columns, rows, padding?, offset? })` emits `columns × rows` rects in row-major order.
- `TextureAtlasLayouts` — main-world registry. API: `add(layout): TextureAtlasLayoutHandle`, `get(handle)`, `replace(handle, layout)`, `remove(handle)`, `has`, `size`, `iter`, `drainPendingChanges`. Auto-inserted by `SpritePlugin`.
- `TextureAtlasLayoutHandle` — branded `number`, opaque identifier.
- `TextureAtlasLayoutAssetEvent` — `{ kind: 'added' | 'modified' | 'removed'; handle }`.
- `TextureAtlasFromGridOptions` — input shape for `TextureAtlasLayout.fromGrid`.
- `TextureAtlas` — ECS component carrying `{ layout: TextureAtlasLayoutHandle; index: number }`. Spawn alongside `Sprite`: `cmd.spawn(new Sprite({ image }), new TextureAtlas(layout, 0))`. Mutate `atlas.index` + call `world.markChanged(entity, TextureAtlas)` to change frame.
- `atlasSyncSystem` — pure system function. Registered by `SpritePlugin` with label `'atlas-sync'`. Exposed for tests / benches / custom registration.
- `calculateSpriteBoundsSystem` — pure system function. Registered by `SpritePlugin` with label `'sprite-bounds'` (`after: ['atlas-sync']`). Auto-AABB for sprite entities so frustum culling kicks in. Skips entities carrying `NoFrustumCulling` for parity with the mesh equivalent.

**Behaviour changes (non-breaking):**

- `SpritePlugin.build` now inserts `TextureAtlasLayouts` and registers two systems in `'postUpdate'`. Plugins re-adding `SpritePlugin` are unaffected (insertion is idempotent).
- Sprite entities now receive an `Aabb` component automatically. Code that previously relied on `Sprite` entities lacking `Aabb` (e.g. broad-phase queries) should attach `NoFrustumCulling` to the entities that should opt out.
