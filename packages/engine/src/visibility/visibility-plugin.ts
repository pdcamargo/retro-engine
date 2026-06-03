import { Aabb, Frustum } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';

import { Camera } from '../camera/camera';
import { RenderLayers } from '../camera/render-layers';
import { RemovedComponents } from '../change-detection';
import { Parent } from '../hierarchy';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { Query, ResMut } from '../system-param';
import { GlobalTransform } from '../transform';
import { checkVisibilitySystem } from './check-visibility';
import { CheckVisibilityState } from './cull-state';
import { updateFrustaSystem } from './update-frusta';
import {
  InheritedVisibility,
  NoFrustumCulling,
  ViewVisibility,
  Visibility,
} from './visibility';
import { visibilityPropagateSystem } from './visibility-propagate';

/**
 * Framework plugin owning the visibility pipeline: builds each active
 * camera's {@link Frustum} from its view-projection, propagates
 * {@link Visibility} through the hierarchy into
 * {@link InheritedVisibility}, then writes per-entity
 * {@link ViewVisibility} after running every renderable through the
 * camera-layer + frustum-vs-AABB tests.
 *
 * All three systems register in `'postUpdate'`, after `CameraPlugin`'s
 * computed-camera refresh, in the named order Bevy ships as
 * `VisibilitySystems`:
 *
 * 1. **`CalculateBounds`** — reserved slot, no system registered yet. Phase
 *    6 (meshes) will fill it with the mesh-driven {@link Aabb} auto-builder.
 * 2. **`UpdateFrusta`** — `updateFrustaSystem`.
 * 3. **`VisibilityPropagate`** — `visibilityPropagateSystem`.
 * 4. **`CheckVisibility`** — `checkVisibilitySystem`.
 *
 * Ordering within the stage is registration-order in v1 (no sub-set
 * namespace for `'postUpdate'`); adding a system between the two would
 * require an explicit register-then-reorder primitive that the engine
 * does not yet ship.
 *
 * `CorePlugin` registers this automatically after `CameraPlugin`. Re-adding
 * it manually throws (it's unique).
 */
export class VisibilityPlugin implements PluginObject {
  name(): string {
    return 'VisibilityPlugin';
  }

  build(app: App): void {
    app.insertResource(new CheckVisibilityState());

    // Only the authored intent persists. InheritedVisibility and ViewVisibility
    // are derived each frame by the systems below, so they are not registered.
    app.registerComponent(
      Visibility,
      { mode: t.enum('Inherited', 'Hidden', 'Visible') },
      { name: 'Visibility' },
    );

    app.addSystem('postUpdate', [Query([Camera, Frustum])], (cameras) => {
      updateFrustaSystem(cameras);
    });

    app.addSystem(
      'postUpdate',
      [
        Query([Visibility], { changed: [Visibility] }),
        Query([Parent], { changed: [Parent] }),
        RemovedComponents(Parent),
      ],
      (changedVisibility, changedParents, removedParents) => {
        visibilityPropagateSystem(
          app.world,
          app.logger,
          changedVisibility,
          changedParents,
          removedParents,
        );
      },
    );

    app.addSystem(
      'postUpdate',
      [
        Query([Camera, Frustum]),
        Query([InheritedVisibility, ViewVisibility], { has: [NoFrustumCulling] }),
        ResMut(CheckVisibilityState),
        Query([InheritedVisibility, ViewVisibility], { changed: [GlobalTransform] }),
        Query([InheritedVisibility, ViewVisibility], { changed: [Aabb] }),
        Query([InheritedVisibility, ViewVisibility], { changed: [InheritedVisibility] }),
        Query([InheritedVisibility, ViewVisibility], { changed: [RenderLayers] }),
        RemovedComponents(Aabb),
        RemovedComponents(NoFrustumCulling),
      ],
      (
        cameras,
        renderables,
        state,
        changedTransforms,
        changedAabbs,
        changedInherited,
        changedLayers,
        removedAabbs,
        removedNoFrustum,
      ) => {
        checkVisibilitySystem(
          app.world,
          cameras,
          renderables,
          state,
          changedTransforms,
          changedAabbs,
          changedInherited,
          changedLayers,
          removedAabbs,
          removedNoFrustum,
        );
      },
    );
  }
}
