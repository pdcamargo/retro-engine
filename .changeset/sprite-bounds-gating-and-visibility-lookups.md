---
'@retro-engine/engine': patch
---

fix(engine): change-gate sprite bounds + trim checkVisibility per-entity lookups

Two CPU-side wins on the per-frame visibility path, found in the post-instancing
"large" stress trace:

- **`calculateSpriteBoundsSystem` is change-gated.** It previously recomputed a
  local `Aabb` and `insertBundle`'d it for every sprite every frame (the 2D twin
  of the `calculateBoundsSystem` issue). It now runs only for sprites whose
  `Sprite` or `TextureAtlas` changed (the union of two `changed` queries,
  deduplicated). **Behaviour change:** mutating an underlying `Image`'s
  dimensions or a `TextureAtlasLayout` in place no longer refreshes a sprite's
  bounds on its own — re-insert `Sprite` or call
  `world.markChanged(entity, Sprite)`. Spawning, mutating `Sprite`/`TextureAtlas`,
  and atlas animation already flag the component, so they refresh normally.

- **`checkVisibilitySystem` does fewer `getComponent` calls.** `NoFrustumCulling`
  presence now comes from a `has` row flag instead of a lookup, and `Aabb` /
  `GlobalTransform` are fetched once per entity instead of twice — roughly
  halving the per-entity lookups on the cullable path. No behaviour change.
