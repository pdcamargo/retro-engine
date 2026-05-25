import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { RenderSet } from '../render-set';
import { ResMut } from '../system-param';

import { EntityTransformGpuCache, gcEntityTransforms } from './mesh-3d-transforms';

/**
 * Plugin that registers the single per-frame garbage-collection system for
 * {@link EntityTransformGpuCache}. Inserted idempotently by every material
 * plugin (3D + 2D) so the system runs once per frame regardless of how many
 * material plugins share the cache.
 *
 * The GC system is scheduled in `RenderSet.PhaseSort`, which the engine runs
 * strictly after every system in `RenderSet.Queue`. By the time GC runs every
 * queue has populated `cache.liveThisFrame`, so the cache cannot evict an
 * entry that another queue still depends on.
 */
export class MeshTransformGcPlugin implements PluginObject {
  name(): string {
    return 'MeshTransformGcPlugin';
  }

  isUnique(): boolean {
    return false;
  }

  build(app: App): void {
    if (app.getResource(EntityTransformGpuCache) === undefined) {
      app.insertResource(new EntityTransformGpuCache());
    }
    const cache = app.getResource(EntityTransformGpuCache)!;
    if (cache.gcSystemRegistered) return;
    cache.gcSystemRegistered = true;

    app.addSystem(
      'render',
      [ResMut(EntityTransformGpuCache)],
      (c) => {
        gcEntityTransforms(c as EntityTransformGpuCache);
      },
      { set: RenderSet.PhaseSort, label: 'mesh-transform-gc' },
    );
  }
}
