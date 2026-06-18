import { type Entity } from '@retro-engine/ecs';
import { type App, Camera } from '@retro-engine/engine';

import { type ViewportTarget } from './viewport';

/**
 * Locate the camera entity that renders into a given editor viewport texture.
 * Both the gizmo driver and the scene picker key off the same camera (its
 * computed view-projection, world position, and target size), so they share
 * this lookup rather than each re-querying the world.
 */
export const findEditorCamera = (
  app: App,
  view: ViewportTarget,
): { entity: Entity; camera: Camera } | undefined => {
  for (const [entity, camera] of app.world.query([Camera]).entries()) {
    if (camera.target.kind === 'texture' && camera.target.texture === view.texture) {
      return { entity, camera };
    }
  }
  return undefined;
};
