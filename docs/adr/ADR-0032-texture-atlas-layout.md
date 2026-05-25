# ADR-0032: `TextureAtlasLayout` + `TextureAtlas` — per-frame sprite UV from an atlas asset

- **Status:** Accepted
- **Date:** 2026-05-25

## Context

Renderer Phase 8.1 ([ADR-0031](ADR-0031-sprite-pipeline-and-core2d-phase-trio.md)) shipped `Sprite` + `SpritePipeline` + the Core2d phase trio. The `Sprite.rect: Rect | undefined` field is the forward-compatible per-frame UV override — `packSpriteInstance` reads it directly as normalised UV and falls back to `[0, 1]²` when absent. ADR-0031 §"Not yet done" deferred `TextureAtlasLayout` / `TextureAtlas` to "the atlas phase, when texture dimensions become layout-stable," and bound per-sprite frustum culling to the same milestone.

Tile maps and animated character sheets are the canonical 2D rendering shape. Both are the same data pattern Bevy ships: a layout asset that carves an image into `N` rectangles plus a per-entity index naming "which rectangle to render right now." The sprite hot path is already there — Phase 8.2 is data + a small `postUpdate` system that writes `sprite.rect = layout.textures[atlas.index]` each frame. No pipeline changes.

As a load-bearing side effect, populating `Aabb` on sprite entities turns on the frustum-cull path already wired through `checkVisibilitySystem`. ADR-0031 explicitly bound that to this phase.

Out of scope (each documented in §"Not yet done" with its trigger):

- **Animated atlas playback** — a ticker that bumps `atlas.index` every N ms. Phase 8.4 / animation system.
- **JSON importers** (Aseprite, TexturePacker) — Phase 11 alongside glTF, with the asset system.
- **Per-tile margin / rotation in the layout** — niche; add when a measured-perf consumer asks.
- **Hot-reload of layout assets affecting existing sprites** — needs an asset-event router. Treat layouts as immutable in 8.2.
- **A "sparse / non-grid" constructor** — `new TextureAtlasLayout(size, hand-authored Rect[])` already supports it.

## Decision

1. **Phase 8.2 lives in `packages/engine/src/sprite/`.** One concern per file (CLAUDE.md §5.5). No new submodule; the atlas asset belongs to the sprite story, mirroring how `Mesh3d` lives in `mesh/` rather than a separate `bounding/` folder. Files: `texture-atlas-layout.ts`, `texture-atlas-layouts.ts`, `texture-atlas.ts`, `atlas-sync.ts`, `calculate-sprite-bounds.ts` + sibling tests.

2. **`TextureAtlasLayout` is a plain value class — the data asset.** Fields: `size: Vec2` (source image dimensions, in pixels) + `textures: Rect[]` (sub-rects in **normalised UV space**, the same shape `Sprite.rect` accepts). Static factory `TextureAtlasLayout.fromGrid({ tileSize, columns, rows, padding?, offset? })` normalises pixel inputs once at build time and emits `columns × rows` rects in row-major order. The constructor accepts an arbitrary `Rect[]` for sparse / non-grid layouts authored by hand.

3. **Normalised-UV storage in `textures[]`, not pixels.** `packSpriteInstance` already reads `Sprite.rect` as normalised UV ([0, 1]²) — storing layout rects pre-normalised keeps the atlas-sync write zero-conversion. Per-tile pixel size remains derivable as `layout.size × (rect.max − rect.min)` when the bounds system needs it. Sparse and grid layouts use the same expression — no separate `tileSize` field on the layout, which would diverge for non-grid carvings.

4. **`TextureAtlasLayouts` is the pre-asset-system registry.** Main-world resource. `TextureAtlasLayoutHandle` is a branded `number`. API mirrors `Images` verbatim: `add | get | has | replace | remove | size | iter | drainPendingChanges`. Event shape mirrors `ImageAssetEvent`: `{ kind: 'added' | 'modified' | 'removed'; handle }`. When `@retro-engine/assets` lands, `TextureAtlasLayouts` folds into `AssetServer<TextureAtlasLayout>` and the event queue becomes the standard `AssetEvent<TextureAtlasLayout>` channel — the upgrade path is structural.

5. **`TextureAtlas` is the ECS component naming `(layout, index)`.** Fields: `layout: TextureAtlasLayoutHandle` + `index: number` (default `0`). Spawn alongside a `Sprite`: `cmd.spawn(new Sprite({ image }), new TextureAtlas(layout, 0))`. Mutate `atlas.index` from gameplay code to change frame; call `world.markChanged(entity, TextureAtlas)` so the atlas-sync filter fires. No `requires` — the sprite alongside already pulls `Transform` / `GlobalTransform` / `Visibility` / etc.

6. **One `postUpdate` system, `atlas-sync`.** Registered by `SpritePlugin`. Query shape: `(Sprite, TextureAtlas)` filtered by `Changed<TextureAtlas>`. Per row: look up layout, read `layout.textures[atlas.index]`, write `sprite.rect = rect`, call `world.markChanged(entity, Sprite)` so downstream consumers observing `Changed<Sprite>` see the update. Out-of-bounds indices and unknown layout handles are silent no-ops — the sprite keeps its prior `rect`, mirroring how the renderer treats a missing `ImageHandle`.

7. **`SpritePlugin` owns it.** No separate `AtlasPlugin` — one system, one registry insert, fold to keep the plugin list compact. `SpritePlugin.build` inserts `TextureAtlasLayouts` (idempotent), registers `'atlas-sync'` in `'postUpdate'`, and registers `'sprite-bounds'` in `'postUpdate'` (`after: ['atlas-sync']`).

8. **`calculateSpriteBoundsSystem` is the 2D twin of `calculateBoundsSystem`.** Lives in `packages/engine/src/sprite/calculate-sprite-bounds.ts`. Query shape: `(Sprite,)` filtered by `Without<NoFrustumCulling>`. Per row, derive footprint pixel size — `customSize`, then atlas tile size (`layout.size × uvSpan(layout.textures[index])`) when a `TextureAtlas` is present, then source image dimensions otherwise — and compute a local-space `Aabb` at z=0, anchor-aware so the centre matches `packSpriteInstance`'s vertex placement (`min = -anchor·size`, `max = (1−anchor)·size`). `world.insertBundle(entity, [aabb])` writes the result; `checkVisibilitySystem` (ADR-0021) consumes it as it already does for `Mesh3d` entities.

9. **Layout-asset mutations do not propagate to existing sprites.** Replacing a layout's `textures[]` via `TextureAtlasLayouts.replace` does not re-fire the `Changed<TextureAtlas>` filter on entities using the layout — the entity's `TextureAtlas` component itself didn't change. Documented in §"Not yet done"; treat layouts as immutable in 8.2. Hot-reload arrives with the asset-event router in the asset-system phase.

10. **Per-image source-alpha bucketing is still approximated by `color.w === 1`.** Inherited from ADR-0031 §15 (`SpriteAlphaBucket`). An atlas with translucent tiles still routes via the sprite's tint alpha. The full per-tile source-alpha analysis lands when a measured-perf consumer asks; the atlas data path imposes no new constraint here.

Composition-only. No abstract `AtlasLike` base class; no `Plugin` proliferation; `Sprite.rect` itself is unchanged from Phase 8.1. The atlas layer adds two resources, one component, and two systems — every piece is reusable independently (a user could call `atlasSyncSystem` directly with a hand-built query without instantiating `SpritePlugin`).

## Consequences

**Easier:**

- Tile maps and animated character sheets are first-class. A 64-sprite tile-map scene is one image + one layout + 64 entities — the bind-group cache hits the same `BindGroup` for all of them, so all 64 sprites batch into one instanced draw.
- `Sprite.rect` is now driven automatically when paired with `TextureAtlas`. Gameplay code mutates `atlas.index`, not `sprite.rect` — the canonical Bevy pattern.
- Per-sprite frustum culling is finally on. Scenes with thousands of off-screen sprites no longer pay the prepare-time pack cost for sprites the camera can't see.
- The data shape lines up with what an animation system writes (Phase 8.4): an animator bumps `atlas.index` once per frame, the engine handles the UV propagation. Animation isn't part of 8.2, but the shape is ready.
- A custom 2D animation system (or a procedural tile cycler) needs zero new plugins — just write a system that mutates `atlas.index` and calls `markChanged`.

**Harder / accepted trade-offs:**

- **Layout hot-reload is manual.** Replacing a layout's `textures[]` requires either re-spawning the affected entities or manually toggling each `TextureAtlas.layout` to re-fire the change-detection filter. Acceptable in 8.2; the asset-event router lands with the asset system.
- **No grid validation against the source image.** `TextureAtlasLayout.fromGrid` derives a `size` from the grid parameters — it does not check that the matching `Image` actually has those pixel dimensions. A 64×64 layout used against a 32×32 image will sample outside `[0, 1]` UV space and clamp / repeat per the sampler. The mismatch surfaces visually rather than as a throw; documented in TSDoc, optional structural validation deferred to the asset system.
- **One more `postUpdate` system in the chain.** `'atlas-sync'` and `'sprite-bounds'` both run every frame. The change-detection filter on atlas-sync keeps the per-frame iteration cost bounded by the number of mutated entities, not the total; sprite-bounds runs over all sprite entities every frame (same shape as `calculateBoundsSystem` for meshes — see ADR-0021's note about deferring a `Changed<Sprite>`-gated form once profiling justifies it).
- **`TextureAtlas.index` is a plain `number`.** A separate `AtlasIndex` value class would prevent confusing it with array indices in user code, but the runtime cost of boxing per atlas entity is unattractive and Bevy uses a plain number too.

## Not yet done

Each entry below is deferred until its trigger consumer lands.

- **Animated atlas playback** — a frame ticker that bumps `atlas.index` over time. Phase 8.4 / animation system.
- **Aseprite / TexturePacker JSON importers** — Phase 11 with the asset system.
- **Per-tile margin / rotation in the layout** — niche; add when a measured-perf consumer asks.
- **Hot-reload of layout assets on existing sprites** — needs an asset-event router. Asset-system phase.
- **Sparse-layout fancy constructor** — `new TextureAtlasLayout(size, Rect[])` already covers it.
- **Structural mismatch validation** (layout-derived `size` vs source `Image.size`) — asset-system phase.
- **`Changed<Sprite>`-gated `calculate-sprite-bounds`** — once profiling shows the every-frame walk hurts.

## Implementation

- `packages/engine/src/sprite/texture-atlas-layout.ts` — `TextureAtlasLayout` value class, `TextureAtlasLayout.fromGrid`, `TextureAtlasFromGridOptions`.
- `packages/engine/src/sprite/texture-atlas-layouts.ts` — `TextureAtlasLayouts` registry, `TextureAtlasLayoutHandle`, `TextureAtlasLayoutAssetEvent`.
- `packages/engine/src/sprite/texture-atlas.ts` — `TextureAtlas` ECS component.
- `packages/engine/src/sprite/atlas-sync.ts` — `atlasSyncSystem` function.
- `packages/engine/src/sprite/calculate-sprite-bounds.ts` — `calculateSpriteBoundsSystem` function (the 2D sibling of `mesh/calculate-bounds.ts`).
- `packages/engine/src/sprite/sprite-plugin.ts` — `SpritePlugin.build` inserts `TextureAtlasLayouts` and registers the two new `postUpdate` systems (`'atlas-sync'` and `'sprite-bounds'`).
- `packages/engine/src/sprite/index.ts` — re-exports the new surface.
- `packages/engine/src/index.ts` — re-exports the sprite module's new surface from the engine root.
- `packages/engine/src/sprite/texture-atlas-layout.test.ts` — `fromGrid` unit tests + sparse round-trip.
- `packages/engine/src/sprite/atlas-sync.test.ts` — integration tests: per-instance UV slots match layout rects, single batched draw, change-detection re-sync, out-of-bounds index no-op.
- `packages/engine/src/sprite/calculate-sprite-bounds.test.ts` — bounds with/without atlas, with/without `customSize`, anchor variants, `NoFrustumCulling` skip.
- `packages/engine/bench/atlas-sync.bench.ts` — atlas-sync hot path: 1000 sprites at 100% and 0% changed rates.
- `apps/playground/src/atlas-showcase-plugin.ts` — 8×8 grid of sprites sharing one procedurally generated tile sheet + one 4×4 layout.
- `apps/playground/src/main.ts` — `?mode=atlas` query-string switch routes to the new showcase.
- `.changeset/texture-atlas.md` — public-surface delta (minor bump).
