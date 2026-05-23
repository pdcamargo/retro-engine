import { Frustum } from '@retro-engine/math';

import { Camera } from '../camera/camera';

/**
 * `'postUpdate'` system: refresh each active camera's {@link Frustum} from
 * its computed view-projection matrix. The `Frustum` component is added to
 * `Camera` via `static requires` so it is guaranteed present by the time
 * this system runs.
 *
 * Inactive cameras keep their previous frustum — the data is stale, but no
 * culling reads from an inactive camera so the staleness is harmless.
 */
export interface UpdateFrustaCameras {
  entries(): Iterable<readonly [number, Camera, Frustum]>;
}

export const updateFrustaSystem = (cameras: UpdateFrustaCameras): void => {
  for (const [, camera, frustum] of cameras.entries()) {
    if (!camera.isActive) continue;
    Frustum.fromViewProj(camera.computed.viewProjectionMatrix, frustum);
  }
};
