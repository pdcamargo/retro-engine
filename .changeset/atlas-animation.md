---
'@retro-engine/engine': minor
---

feat(engine): AtlasAnimation — time-driven TextureAtlas.index ticker for animated sprites

Phase 8.4 lands the minimum viable sprite animator on top of Phase 8.2's texture-atlas data path. Per ADR-0033. A new `AtlasAnimation` component carries `{ firstIndex, lastIndex, fps, mode, paused, elapsedSec }`; a new `'atlas-animation'` system in `'postUpdate'` (ordered `before: ['atlas-sync']`) advances `TextureAtlas.index` over time on every animated entity and marks the component changed so `atlas-sync` re-writes `sprite.rect` in the same frame. Animation reads `Time.virtual.delta`, so the standard virtual-time pause/scale knobs apply uniformly.

Mode shapes: `'loop'` wraps `firstIndex → lastIndex → firstIndex` forever; `'once'` plays through then self-pauses at `lastIndex`; `'pingPong'` ping-pongs without repeating endpoints (a 4-frame range yields `0,1,2,3,2,1,0,1,…`). Forward-only — `firstIndex > lastIndex` is silently skipped; explicit reverse playback is deferred to the full animation system (Phase 9).

**New public surface:**

- `AtlasAnimation` — ECS component carrying `{ firstIndex: number; lastIndex: number; fps: number; mode: 'loop' | 'once' | 'pingPong'; paused: boolean; elapsedSec: number }`. Options-bag constructor with `mode` (default `'loop'`) and `paused` (default `false`) optional. Spawn alongside `Sprite + TextureAtlas`: `cmd.spawn(new Sprite({ image }), new TextureAtlas(layout, 0), new AtlasAnimation({ firstIndex: 0, lastIndex: 7, fps: 12 }))`.
- `AtlasAnimationOptions` — input shape for the constructor.
- `AtlasAnimationMode` — `'loop' | 'once' | 'pingPong'`.
- `atlasAnimationSystem` — pure system function. Registered by `SpritePlugin` with label `'atlas-animation'` and ordering `before: ['atlas-sync']`. Exposed for tests / benches / custom registration.

**Behaviour changes (non-breaking):**

- `SpritePlugin.build` now registers three `'postUpdate'` systems (`'atlas-animation'` → `'atlas-sync'` → `'sprite-bounds'`) instead of two. Plugins re-adding `SpritePlugin` are unaffected (insertion is idempotent).
- Entities carrying an `AtlasAnimation` will see their `TextureAtlas.index` advance every frame the system runs. Code that previously relied on `TextureAtlas.index` being stable should either drop the `AtlasAnimation` from those entities or set `paused = true`.
