import { Frustum } from '@retro-engine/math';

import { Camera } from '../camera/camera';
import { RemovedComponents } from '../change-detection';
import { Parent } from '../hierarchy';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { Query } from '../system-param';
import { checkVisibilitySystem } from './check-visibility';
import { updateFrustaSystem } from './update-frusta';
import {
  InheritedVisibility,
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
      [Query([Camera, Frustum]), Query([InheritedVisibility, ViewVisibility])],
      (cameras, renderables) => {
        checkVisibilitySystem(app.world, cameras, renderables);
      },
    );
  }
}
