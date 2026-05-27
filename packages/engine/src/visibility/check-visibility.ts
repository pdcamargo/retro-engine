import type { ComponentType, Entity, Query as QueryHandle, World } from '@retro-engine/ecs';
import { Aabb, Frustum, frustumIntersectsAabb } from '@retro-engine/math';

import { Camera } from '../camera/camera';
import { RenderLayers } from '../camera/render-layers';
import { GlobalTransform } from '../transform';
import { CheckVisibilityState, FLOATS_PER_CAMERA } from './cull-state';
import { InheritedVisibility, NoFrustumCulling, ViewVisibility } from './visibility';

type CamerasQuery = QueryHandle<readonly [typeof Camera, typeof Frustum]>;
type RenderablesQuery = QueryHandle<
  readonly [typeof InheritedVisibility, typeof ViewVisibility],
  { has: readonly (typeof NoFrustumCulling)[] }
>;
/**
 * A renderable query gated on one changed component. `changed` does not alter
 * the row shape (still `[entity, InheritedVisibility, ViewVisibility]`), and it
 * implicitly requires the gated component to be present on the archetype.
 */
type DirtyQuery = QueryHandle<
  readonly [typeof InheritedVisibility, typeof ViewVisibility],
  { readonly changed: readonly ComponentType[] }
>;

interface ActiveCameraCullingInfo {
  readonly frustum: Frustum;
  readonly layerMask: number;
}

const scratchWorldAabb = new Aabb();

/**
 * Core per-entity visibility decision, shared by the full pass and the
 * change-gated pass so both emit identical results. Returns whether `entity`
 * is visible to at least one active camera, applying hierarchy gating, the
 * render-layer mask, and (unless the entity opts out) frustum-vs-AABB.
 */
const evaluateViewVisible = (
  world: World,
  entity: Entity,
  inherited: InheritedVisibility,
  hasNoFrustumCulling: boolean,
  active: readonly ActiveCameraCullingInfo[],
): boolean => {
  if (!inherited.visible) return false;

  const entityLayers = world.getComponent(entity, RenderLayers);
  const entityLayerMask = entityLayers?.mask ?? RenderLayers.DEFAULT_MASK;
  const localAabb = hasNoFrustumCulling ? undefined : world.getComponent(entity, Aabb);
  const transform = hasNoFrustumCulling ? undefined : world.getComponent(entity, GlobalTransform);
  const skipFrustum = hasNoFrustumCulling || localAabb === undefined || transform === undefined;

  for (const cam of active) {
    if ((entityLayerMask & cam.layerMask) === 0) continue;
    if (skipFrustum) return true;
    Aabb.transform(localAabb!, transform!.matrix, scratchWorldAabb);
    if (frustumIntersectsAabb(cam.frustum, scratchWorldAabb)) return true;
  }
  return false;
};

/** Write `visible` only on a real flip, stamping `Changed<ViewVisibility>` so it stays meaningful. */
const writeVisibility = (world: World, entity: Entity, view: ViewVisibility, visible: boolean): void => {
  if (view.visible !== visible) {
    view.visible = visible;
    world.markChanged(entity, ViewVisibility);
  }
};

/**
 * Flatten this frame's active cameras into `state`'s snapshot buffers in place
 * while detecting whether anything changed since last frame (camera count,
 * any frustum plane coefficient, or any layer mask). Overwrites the snapshot
 * with the current values. Returns `true` if a full recompute is required.
 */
const snapshotChanged = (state: CheckVisibilityState, active: readonly ActiveCameraCullingInfo[]): boolean => {
  const count = active.length;
  state.ensureCapacity(count);
  let changed = count !== state.lastActiveCount;
  const planes = state.lastPlanes;
  const masks = state.lastLayerMasks;

  for (let c = 0; c < count; c++) {
    const cam = active[c]!;
    if (masks[c] !== cam.layerMask) {
      changed = true;
      masks[c] = cam.layerMask;
    }
    let base = c * FLOATS_PER_CAMERA;
    for (let p = 0; p < 6; p++) {
      const plane = cam.frustum.planes[p]!;
      const n = plane.normal;
      const next0 = n[0] as number;
      const next1 = n[1] as number;
      const next2 = n[2] as number;
      const next3 = plane.d;
      if (
        planes[base] !== next0 ||
        planes[base + 1] !== next1 ||
        planes[base + 2] !== next2 ||
        planes[base + 3] !== next3
      ) {
        changed = true;
        planes[base] = next0;
        planes[base + 1] = next1;
        planes[base + 2] = next2;
        planes[base + 3] = next3;
      }
      base += 4;
    }
  }

  state.lastActiveCount = count;
  return changed;
};

/**
 * `'postUpdate'` system: write each renderable entity's per-frame
 * {@link ViewVisibility.visible} based on (a) the resolved
 * {@link InheritedVisibility} hierarchy, (b) render-layer mask intersection
 * with each active camera, and (c) frustum-vs-AABB intersection for
 * entities that carry an {@link Aabb} and {@link GlobalTransform}.
 *
 * Change-gated: when the active-camera set is unchanged from last frame, only
 * entities whose own culling inputs changed are recomputed — a static scene
 * does O(changed) work. Any camera move, projection change, or add / remove
 * is detected by a snapshot compare of the active frusta + layer masks and
 * forces a full recompute that frame, so the result is always identical to a
 * per-frame full pass. Writes are change-stamped only on a real flip, so
 * downstream `Changed<ViewVisibility>` fires exactly on visibility edges.
 *
 * The aggregate is a single boolean across every active camera this frame;
 * per-camera filtering belongs with the render-graph work.
 *
 * @internal Engine-private; registered by `VisibilityPlugin` in `'postUpdate'`.
 */
export const checkVisibilitySystem = (
  world: World,
  cameras: CamerasQuery,
  renderables: RenderablesQuery,
  state: CheckVisibilityState,
  changedTransforms: DirtyQuery,
  changedAabbs: DirtyQuery,
  changedInherited: DirtyQuery,
  changedLayers: DirtyQuery,
  removedAabbs: Iterable<Entity>,
  removedNoFrustum: Iterable<Entity>,
): void => {
  // Snapshot every active camera's frustum + layer mask up front so the
  // per-entity decision reads from a flat array instead of re-querying.
  const active: ActiveCameraCullingInfo[] = [];
  for (const [entity, camera, frustum] of cameras.entries()) {
    if (!camera.isActive) continue;
    const layers = world.getComponent(entity, RenderLayers);
    active.push({ frustum, layerMask: layers?.mask ?? RenderLayers.DEFAULT_MASK });
  }

  const fullPass = snapshotChanged(state, active);

  if (fullPass) {
    // Camera set changed (or first frame / empty-camera transition): recompute
    // every renderable. With no active cameras every entity resolves to hidden.
    renderables.forEach((entry) => {
      const entity = entry[0] as Entity;
      const inherited = entry[1] as InheritedVisibility;
      const view = entry[2] as ViewVisibility;
      const hasNoFrustumCulling = entry[3] as boolean;
      const visible = active.length === 0 ? false : evaluateViewVisible(world, entity, inherited, hasNoFrustumCulling, active);
      writeVisibility(world, entity, view, visible);
    });
    return;
  }

  // Change-gated pass: only entities whose own culling inputs changed since the
  // cull last ran. `Changed<…>` queries yield live rows only; the removed
  // iterables can name despawned entities, so each recompute is liveness-guarded.
  const dirty = state.dirty;
  dirty.clear();
  for (const row of changedTransforms.entries()) dirty.add(row[0] as Entity);
  for (const row of changedAabbs.entries()) dirty.add(row[0] as Entity);
  for (const row of changedInherited.entries()) dirty.add(row[0] as Entity);
  for (const row of changedLayers.entries()) dirty.add(row[0] as Entity);
  for (const entity of removedAabbs) dirty.add(entity);
  for (const entity of removedNoFrustum) dirty.add(entity);

  for (const entity of dirty) {
    const view = world.getComponent(entity, ViewVisibility);
    if (view === undefined) continue; // despawned or no longer a renderable
    const inherited = world.getComponent(entity, InheritedVisibility);
    if (inherited === undefined) continue;
    const hasNoFrustumCulling = world.getComponent(entity, NoFrustumCulling) !== undefined;
    const visible = evaluateViewVisible(world, entity, inherited, hasNoFrustumCulling, active);
    writeVisibility(world, entity, view, visible);
  }
};
