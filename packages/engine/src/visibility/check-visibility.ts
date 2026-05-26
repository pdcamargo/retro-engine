import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';
import { Aabb, Frustum, frustumIntersectsAabb } from '@retro-engine/math';

import { Camera } from '../camera/camera';
import { RenderLayers } from '../camera/render-layers';
import { GlobalTransform } from '../transform';
import { InheritedVisibility, NoFrustumCulling, ViewVisibility } from './visibility';

type CamerasQuery = QueryHandle<readonly [typeof Camera, typeof Frustum]>;
type RenderablesQuery = QueryHandle<
  readonly [typeof InheritedVisibility, typeof ViewVisibility],
  { has: readonly (typeof NoFrustumCulling)[] }
>;

interface ActiveCameraCullingInfo {
  readonly frustum: Frustum;
  readonly layerMask: number;
}

const scratchWorldAabb = new Aabb();

/**
 * `'postUpdate'` system: write each renderable entity's per-frame
 * {@link ViewVisibility.visible} based on (a) the resolved
 * {@link InheritedVisibility} hierarchy, (b) render-layer mask intersection
 * with each active camera, and (c) frustum-vs-AABB intersection for
 * entities that carry an {@link Aabb} and {@link GlobalTransform}.
 *
 * Per-entity decision flow:
 *
 * 1. If {@link InheritedVisibility.visible} is `false`, the entity is hidden
 *    by the hierarchy — write `ViewVisibility.visible = false` and skip the
 *    camera loop.
 * 2. Otherwise iterate every active camera. For each:
 *    - If the entity's {@link RenderLayers} mask doesn't intersect the
 *      camera's mask, skip this camera. The default mask (component absent)
 *      is layer 0, so absent-on-both matches.
 *    - If the entity has {@link NoFrustumCulling}, or no {@link Aabb}, or
 *      no {@link GlobalTransform}, the frustum test is short-circuited as a
 *      hit — the entity is visible to this camera, set
 *      `ViewVisibility.visible = true`, and stop iterating cameras.
 *    - Otherwise transform the local-space AABB into world space and run
 *      {@link frustumIntersectsAabb}. On hit, set visible and stop.
 * 3. If no camera reported visibility, `ViewVisibility.visible` ends the
 *    pass at `false`.
 *
 * The aggregate is a single boolean across every active camera this frame.
 * Per-camera filtering belongs with the render-graph work; entities that
 * are visible from at least one camera see `true` here and rely on
 * downstream code to skip drawing them where they are not actually wanted.
 *
 * @internal Engine-private; registered by `VisibilityPlugin` in `'postUpdate'`.
 */
export const checkVisibilitySystem = (
  world: World,
  cameras: CamerasQuery,
  renderables: RenderablesQuery,
): void => {
  // Snapshot every active camera's frustum + layer mask up front so the
  // renderable loop reads from a flat array instead of re-querying.
  const active: ActiveCameraCullingInfo[] = [];
  for (const [entity, camera, frustum] of cameras.entries()) {
    if (!camera.isActive) continue;
    const layers = world.getComponent(entity, RenderLayers);
    active.push({
      frustum,
      layerMask: layers?.mask ?? RenderLayers.DEFAULT_MASK,
    });
  }

  if (active.length === 0) {
    renderables.forEach((entry) => {
      (entry[2] as ViewVisibility).visible = false;
    });
    return;
  }

  // Non-allocating per-entity pass — this touches every renderable each frame.
  renderables.forEach((entry) => {
    const entity = entry[0] as Entity;
    const inherited = entry[1] as InheritedVisibility;
    const view = entry[2] as ViewVisibility;
    // `has: [NoFrustumCulling]` surfaces presence as a row flag — cheaper than a
    // per-entity `getComponent`, and the marker carries no data we need.
    const hasNoFrustumCulling = entry[3] as boolean;

    if (!inherited.visible) {
      view.visible = false;
      return;
    }

    const entityLayers = world.getComponent(entity, RenderLayers);
    const entityLayerMask = entityLayers?.mask ?? RenderLayers.DEFAULT_MASK;
    // Fetch the frustum inputs once (not twice as before), and only when the
    // entity opts into culling.
    const localAabb = hasNoFrustumCulling ? undefined : world.getComponent(entity, Aabb);
    const transform = hasNoFrustumCulling ? undefined : world.getComponent(entity, GlobalTransform);
    const skipFrustum = hasNoFrustumCulling || localAabb === undefined || transform === undefined;

    let visible = false;
    for (const cam of active) {
      if ((entityLayerMask & cam.layerMask) === 0) continue;
      if (skipFrustum) {
        visible = true;
        break;
      }
      Aabb.transform(localAabb!, transform!.matrix, scratchWorldAabb);
      if (frustumIntersectsAabb(cam.frustum, scratchWorldAabb)) {
        visible = true;
        break;
      }
    }
    view.visible = visible;
  });
};
