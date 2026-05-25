# ADR-0033: `AtlasAnimation` — time-driven `TextureAtlas.index` ticker for animated sprites

- **Status:** Accepted
- **Date:** 2026-05-25

## Context

Renderer Phase 8.2 ([ADR-0032](ADR-0032-texture-atlas-layout.md)) shipped `TextureAtlasLayout` + `TextureAtlas` + the `'atlas-sync'` `postUpdate` system. The seam was deliberately built for an animator to plug into: gameplay code mutates `atlas.index` and calls `world.markChanged(entity, TextureAtlas)`, and `atlas-sync` propagates the new UV to `sprite.rect` via its `Changed<TextureAtlas>` filter. ADR-0032 §"Not yet done" promised this as "Phase 8.4 / animation system," and the existing TSDoc on `TextureAtlas.index` already names "a sprite animator bumps `atlas.index` every N ms" as the canonical caller.

Bevy's modern shape is `AnimationConfig { first, last, fps }` + a per-frame timer that writes to `TextureAtlas.index`. Same data pattern, same single-system shape. Phase 8.4 is the minimum viable sprite animator — character sheets, explosion sprites, tile cycling — without any of the structure that the full animation system (Phase 9) needs to support skeletal animation, blends, or state machines.

Out of scope (each documented in §"Not yet done" with its trigger):

- **Multi-clip state machines / blending** — Phase 9.
- **Per-frame variable timing** (frame 0 held 200ms, frame 1 held 80ms) — niche; add when a measured-perf consumer asks.
- **End-of-clip / on-loop events** — fold into the eventual animation event system when message channels stabilise.
- **Explicit `direction: 'forward' | 'reverse'`** — overkill in 8.4; the spec is forward-only.
- **`Changed<AtlasAnimation>`-gated query filter** — once profiling shows the unfiltered per-frame walk hurts.

## Decision

1. **Phase 8.4 lives in `packages/engine/src/sprite/`.** One concern per file (CLAUDE.md §5.5). No new submodule; the animator belongs to the sprite story, mirroring ADR-0032's "fold the atlas asset under sprite/" reasoning. Files: `atlas-animation.ts` + sibling test.

2. **`AtlasAnimation` is the ECS component.** Fields: `firstIndex: number` + `lastIndex: number` (inclusive bounds into the entity's `TextureAtlas`-layout's `textures[]`), `fps: number` (frame advancement rate in Hz), `mode: 'loop' | 'once' | 'pingPong'`, `paused: boolean`, `elapsedSec: number` (internal but surfaced — matches Bevy 0.14+ naming and is consistent with `Time.virtual.elapsed`). Options-bag constructor mirroring `Sprite` / `SpriteOptions`. Defaults: `mode = 'loop'`, `paused = false`, `elapsedSec = 0`. Spawn alongside `TextureAtlas`: `cmd.spawn(new Sprite({ image }), new TextureAtlas(layout, 0), new AtlasAnimation({ firstIndex: 0, lastIndex: 7, fps: 12 }))`.

3. **One `postUpdate` system, `atlas-animation`.** Registered by `SpritePlugin` with label `'atlas-animation'` and ordering `before: ['atlas-sync']`. Query shape: `(AtlasAnimation, TextureAtlas)` with **no `Changed<…>` filter** — every animated entity is visited every frame; per-entity short-circuit is the cheap `paused` check at the top of the loop body. Per row: skip if `paused`; skip ill-formed `firstIndex > lastIndex` ranges; otherwise `elapsedSec += time.virtual.delta`, derive `steps = floor(elapsedSec * fps)`, compute target via mode formula, and write `atlas.index` + call `world.markChanged(entity, TextureAtlas)` only when the target differs from the current. The "only when different" guard means a steady-state animator imposes no atlas-sync work between frame transitions.

4. **`before: ['atlas-sync']` is load-bearing.** Same-frame propagation: animator writes `atlas.index` + `markChanged`, then `atlas-sync` runs (it's ordered after) and its `Changed<TextureAtlas>` filter catches the entity, so `sprite.rect` updates without a one-frame visual delay. The existing `'sprite-bounds'` system (ordered `after: ['atlas-sync']`) sees an up-to-date rect when it computes `Aabb` — no extra wiring for per-frame frustum sanity.

5. **Mode formulas** (range `len = lastIndex - firstIndex + 1`):
   - `'loop'`: `target = firstIndex + (steps % len)`.
   - `'once'`: if `steps >= len - 1`, set `target = lastIndex` and `paused = true` (self-pauses on completion). Else `target = firstIndex + steps`.
   - `'pingPong'`: `period = 2 * (len - 1)`; `phase = steps % period`; `target = phase < len ? firstIndex + phase : lastIndex - (phase - len + 1)`. Endpoints are not repeated — a 4-frame range yields `0,1,2,3,2,1,0,1,…`.
   - Degenerate `len === 1` short-circuits to holding `firstIndex` regardless of mode (no division/modulo by zero).

6. **`Time.virtual.delta`, not `real`.** Mirrors `Transform` propagation and the playground's existing Spin system — pausing virtual time (`time.virtual.paused = true`) pauses every animator uniformly, slow-mo halves their effective fps, etc. Cutscene/audio-sync code that needs wall-clock animation can register a custom system reading `time.real.delta`; this phase doesn't ship two flavours.

7. **Forward-only.** `firstIndex > lastIndex` is a silent skip, not an inverted-range playback. Explicit reverse direction is the kind of surface the full animation system can offer cleanly; baking it into the 8.4 shape would add a second axis to every test case for marginal gain.

8. **`SpritePlugin` owns it.** No separate `AnimationPlugin` — one system, fold under the existing plugin per ADR-0032's precedent. `SpritePlugin.build` gains one more `app.addSystem('postUpdate', …, { label: 'atlas-animation', before: ['atlas-sync'] })` call slotted before the existing atlas-sync registration. No `AnimationPlugin` until the Phase 9 animation system genuinely needs one.

Composition-only. No abstract `Animator` base class, no per-mode subclass; one component, one system, one set of mode formulas inside a single loop. The component is reusable independently — a user could call `atlasAnimationSystem` directly with a hand-built query without instantiating `SpritePlugin`.

## Consequences

**Easier:**

- Animated character sheets and tile cyclers are first-class. Spawn `Sprite + TextureAtlas + AtlasAnimation` and the engine handles UV propagation; no per-frame gameplay code.
- The bench/test pattern mirrors ADR-0032 exactly — one component + one system + `'postUpdate'` label means new contributors can follow the precedent without reading new infrastructure.
- Virtual-time pause and scale apply uniformly to every animator. Slow-mo, time-stop, and pause-menus work without animator-specific plumbing.
- A custom mode (e.g. random tile cycling for damage flashes) is a separate component + system; the standard pattern is small enough to copy without inheriting from `AtlasAnimation`.

**Harder / accepted trade-offs:**

- **No `Changed<AtlasAnimation>` query filter.** The system walks every animated entity every frame. The per-entity cost is one float add + one `Math.floor` + one comparison; the `paused` check short-circuits idle entities at the top of the loop. At thousands of entities this is negligible — verifiable with `bench/atlas-animation.bench.ts`. A `Changed`-gated form lands when profiling shows the unfiltered walk hurts.
- **One more `postUpdate` system in the chain.** `'atlas-animation'` and `'atlas-sync'` and `'sprite-bounds'` all run every frame. Same trade-off as ADR-0032 §60 — bounded by the change-detection filter on atlas-sync where it matters.
- **`elapsedSec` grows unbounded for `'loop'` and `'pingPong'`.** Over very long sessions, `floor(elapsedSec * fps)` could approach Number.MAX_SAFE_INTEGER. Hours-long playback is fine in practice; a session that genuinely needs unbounded animation can mutate `elapsedSec %= period / fps` from gameplay. Documenting rather than wrapping internally keeps the system body branch-free.
- **`'once'` self-pauses but does not auto-reset on `paused = false`.** A consumer that wants to replay must set `paused = false` *and* `elapsedSec = 0`. Surfacing `elapsedSec` directly is what makes this possible without a separate `reset()` method.

## Not yet done

Each entry below is deferred until its trigger consumer lands.

- **Multi-clip state machines / blending** — Phase 9 animation system.
- **Per-frame variable timing** (per-frame hold durations) — niche; add when a measured-perf consumer asks.
- **End-of-clip / on-loop events** — fold into the eventual animation event system when message channels stabilise.
- **Explicit `direction: 'forward' | 'reverse'`** — overkill in 8.4; the surface stays forward-only.
- **`Changed<AtlasAnimation>`-gated query filter** — once profiling shows the unfiltered walk hurts.
- **Sub-frame interpolation** between tiles (e.g. cross-fading frame N and N+1) — niche; not a sprite-sheet pattern in practice.

## Implementation

- `packages/engine/src/sprite/atlas-animation.ts` — `AtlasAnimation` class, `AtlasAnimationOptions`, `AtlasAnimationMode`, `atlasAnimationSystem` function.
- `packages/engine/src/sprite/sprite-plugin.ts` — `SpritePlugin.build` registers `'atlas-animation'` in `'postUpdate'` with `before: ['atlas-sync']`. Class TSDoc updated to list the new system.
- `packages/engine/src/sprite/index.ts` — re-exports the new surface.
- `packages/engine/src/index.ts` — re-exports the sprite module's new surface from the engine root.
- `packages/engine/src/sprite/atlas-animation.test.ts` — mode formula coverage (loop / once / pingPong / paused / degenerate single-frame range) + integration with `atlas-sync` writing `sprite.rect`.
- `packages/engine/bench/atlas-animation.bench.ts` — atlas-animation hot path: 1000 sprites, all advancing vs all paused.
- `packages/engine/bench/index.ts` — registers the new bench.
- `apps/playground/src/atlas-showcase-plugin.ts` — two of the 64 grid entities now carry an `AtlasAnimation` and visibly cycle through the 16-tile palette; the other 62 stay static.
- `.changeset/atlas-animation.md` — public-surface delta (minor bump).
