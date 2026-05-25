import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';

import { Sprite } from './sprite';
import { TextureAtlas } from './texture-atlas';
import type { TextureAtlasLayouts } from './texture-atlas-layouts';

/**
 * Per-frame sprite UV writer driven by {@link TextureAtlas} components.
 *
 * Registered by `SpritePlugin` in the `'postUpdate'` schedule with label
 * `'atlas-sync'`. The system iterates `(Sprite, TextureAtlas)` entities filtered
 * by `Changed<TextureAtlas>` — gameplay code that mutates `atlas.index` (or
 * `atlas.layout`) must call `world.markChanged(entity, TextureAtlas)`
 * afterwards so the filter fires. Newly spawned entities also pass the filter
 * on their first frame.
 *
 * For each matched entity:
 *
 * 1. Look up the layout asset via {@link TextureAtlasLayouts}.
 * 2. Read `layout.textures[atlas.index]`.
 * 3. Write `sprite.rect = rect` (the layout stores rects in normalised UV, the
 *    same shape `packSpriteInstance` consumes — zero conversion).
 * 4. Call `world.markChanged(entity, Sprite)` so downstream systems observing
 *    `Changed<Sprite>` see the update on their next run. (Phase 8.1's
 *    sprite-prepare reads the current `sprite.rect` directly, not via a
 *    change-detection filter, so the markChanged is for future consumers; it
 *    also keeps the contract uniform with `Transform` propagation.)
 *
 * Unknown layout handles and out-of-bounds indices are silently skipped — the
 * sprite keeps its prior `rect`. Mirrors how the renderer treats a missing
 * `ImageHandle`: a registry that lags by one frame during teardown does not
 * blank the sprite.
 *
 * Layout-asset mutations (replacing a layout's `textures[]` via
 * `TextureAtlasLayouts.replace`) do **not** automatically re-trigger atlassed
 * sprites — the `Changed<TextureAtlas>` filter won't fire. Treat layouts as
 * immutable in the current phase; full hot-reload arrives with the asset
 * system.
 *
 * @param layouts Main-world {@link TextureAtlasLayouts} resource.
 * @param query Query handle over rows `(Sprite, TextureAtlas)` filtered by
 *   `Changed<TextureAtlas>`.
 * @param world The main world, used to bump the `Sprite` change tick after
 *   each rect write.
 */
export const atlasSyncSystem = (
  layouts: TextureAtlasLayouts,
  query: QueryHandle<
    readonly [typeof Sprite, typeof TextureAtlas],
    { changed: readonly (typeof TextureAtlas)[] }
  >,
  world: World,
): void => {
  for (const row of query.entries()) {
    const entity = row[0] as Entity;
    const sprite = row[1] as Sprite;
    const atlas = row[2] as TextureAtlas;
    const layout = layouts.get(atlas.layout);
    if (layout === undefined) continue;
    const rect = layout.textures[atlas.index];
    if (rect === undefined) continue;
    sprite.rect = rect;
    world.markChanged(entity, Sprite);
  }
};
