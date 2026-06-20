import type { Handle } from '@retro-engine/assets';
import { mat4 } from '@retro-engine/math';
import type { Mat4 } from '@retro-engine/math';

import type { Image } from '../image/image';

/**
 * Render-world resource carrying the single environment the scene lights from
 * this frame, extracted from the active camera's {@link
 * import('./environment-map-light').EnvironmentMapLight}. The GPU lighting model
 * is global (one analytic-light set, one environment), so when several cameras
 * each carry an environment the first active one wins — per-camera environments
 * are a documented follow-on.
 *
 * `handle` is `undefined` when no active camera has an environment, which drives
 * the prepare system to revert to the flat-ambient path.
 *
 * @internal
 */
export class ActiveEnvironment {
  /** Source cube image, or `undefined` when no environment is active. */
  handle: Handle<Image> | undefined = undefined;
  /** Overall intensity multiplier. */
  intensity = 1;
  /** Diffuse (irradiance) multiplier. */
  diffuseIntensity = 1;
  /** Specular (reflection) multiplier. */
  specularIntensity = 1;
  /** Lookup rotation baked from the component's quaternion at extract time. */
  readonly rotation: Mat4 = mat4.identity();
}
