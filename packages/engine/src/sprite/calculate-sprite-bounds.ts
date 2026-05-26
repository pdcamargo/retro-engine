import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';
import { Aabb, vec3 } from '@retro-engine/math';

import { Images } from '../image/images';
import { NoFrustumCulling } from '../visibility/visibility';

import { resolveAnchor, Sprite } from './sprite';
import { TextureAtlas } from './texture-atlas';
import type { TextureAtlasLayouts } from './texture-atlas-layouts';

interface PendingAabbInsert {
  entity: Entity;
  aabb: Aabb;
}

/**
 * Auto-AABB writer for `Sprite` entities. The 2D twin of `calculateBoundsSystem`.
 *
 * Registered by `SpritePlugin` in `'postUpdate'`, ordered `after:
 * ['atlas-sync']` so atlassed sprites have their `rect` set before bounds
 * computation. For each matched `Sprite` entity without {@link NoFrustumCulling}
 * it derives a local-space `Aabb` from the sprite's footprint and inserts /
 * overwrites the entity's `Aabb` component. `checkVisibilitySystem` then
 * transforms the AABB into world space each frame and runs the frustum test.
 *
 * Footprint sizing:
 *
 * - `sprite.customSize` set → use it verbatim.
 * - Otherwise, if the entity carries a `TextureAtlas`, pixel size = layout's
 *   source-image dimensions × the indexed rect's UV span. Works uniformly for
 *   grid and sparse layouts.
 * - Otherwise, pixel size = source `Image` dimensions (or `Images.WHITE`'s
 *   1×1 when `sprite.image` is `undefined`).
 *
 * Local-space AABB layout (Y up, Z = 0): for a sprite with footprint
 * `(w, h)` and anchor `(ax, ay)` in `[0, 1]²`, the quad spans
 * `[-ax·w, (1−ax)·w] × [-ay·h, (1−ay)·h]`. The AABB centre is therefore
 * `(w·(0.5 − ax), h·(0.5 − ay), 0)` and the half-extents are
 * `(w/2, h/2, 0)`. This matches `packSpriteInstance`'s anchor placement so a
 * sprite that visibly leaves the camera frustum is also reported as outside
 * by `frustumIntersectsAabb`.
 *
 * A sprite's footprint depends only on its `Sprite` and (when atlassed) its
 * `TextureAtlas`, so the system is change-gated on both: an entity is visited
 * on the frame either component is added or flagged changed, not every frame.
 * The two query handles are the `changed: [Sprite]` and `changed: [TextureAtlas]`
 * slices of the cullable sprites; their union (deduplicated) is processed.
 * Changing an underlying `Image`'s dimensions or a `TextureAtlasLayout` in
 * place does not refresh bounds on its own — re-insert `Sprite` (or
 * `world.markChanged(entity, Sprite)`) on the affected entities.
 *
 * Entities carrying `NoFrustumCulling` are excluded by the query — that marker
 * is the documented "I manage bounds myself" escape hatch, and
 * `checkVisibilitySystem` also short-circuits the frustum test for them.
 *
 * @param layouts Main-world {@link TextureAtlasLayouts} registry.
 * @param images Main-world {@link Images} registry.
 * @param changedSprites Cullable sprites whose `Sprite` changed this frame.
 * @param changedAtlassed Cullable sprites whose `TextureAtlas` changed this frame.
 * @param world The main world, used to insert / overwrite `Aabb` on the
 *   matched entities.
 */
export const calculateSpriteBoundsSystem = (
  layouts: TextureAtlasLayouts,
  images: Images,
  changedSprites: QueryHandle<
    readonly [typeof Sprite],
    { without: readonly (typeof NoFrustumCulling)[]; changed: readonly (typeof Sprite)[] }
  >,
  changedAtlassed: QueryHandle<
    readonly [typeof Sprite],
    { without: readonly (typeof NoFrustumCulling)[]; changed: readonly (typeof TextureAtlas)[] }
  >,
  world: World,
): void => {
  // Defer insert until after iteration. `world.insertBundle` is a structural
  // mutation that can move the entity to a new archetype, swap-removing the
  // row from the archetype a query is currently iterating — same hazard
  // documented on `calculateBoundsSystem`.
  const pending: PendingAabbInsert[] = [];
  const seen = new Set<Entity>();

  const consider = (entity: Entity, sprite: Sprite): void => {
    if (seen.has(entity)) return;
    seen.add(entity);

    let width: number;
    let height: number;
    if (sprite.customSize !== undefined) {
      width = sprite.customSize[0] as number;
      height = sprite.customSize[1] as number;
    } else {
      const atlas = world.getComponent(entity, TextureAtlas);
      if (atlas !== undefined) {
        const layout = layouts.get(atlas.layout);
        if (layout === undefined) return;
        const rect = layout.textures[atlas.index];
        if (rect === undefined) return;
        const layoutW = layout.size[0] as number;
        const layoutH = layout.size[1] as number;
        const minU = rect.min[0] as number;
        const minV = rect.min[1] as number;
        const maxU = rect.max[0] as number;
        const maxV = rect.max[1] as number;
        width = layoutW * (maxU - minU);
        height = layoutH * (maxV - minV);
      } else {
        const handle = sprite.image !== undefined ? sprite.image : images.WHITE;
        const image = images.get(handle);
        if (image === undefined) return;
        width = image.width;
        height = image.height;
      }
    }

    const [ax, ay] = resolveAnchor(sprite.anchor);
    const cx = width * (0.5 - ax);
    const cy = height * (0.5 - ay);
    const aabb = new Aabb(
      vec3.create(cx, cy, 0),
      vec3.create(width * 0.5, height * 0.5, 0),
    );
    pending.push({ entity, aabb });
  };

  for (const row of changedSprites.entries()) consider(row[0] as Entity, row[1] as Sprite);
  for (const row of changedAtlassed.entries()) consider(row[0] as Entity, row[1] as Sprite);

  for (const { entity, aabb } of pending) {
    world.insertBundle(entity, [aabb]);
  }
};
