import type { Handle } from '@retro-engine/assets';
import { quat } from '@retro-engine/math';
import type { Quat } from '@retro-engine/math';

import type { Image } from '../image/image';

/**
 * Per-camera component drawing an environment cubemap as the scene background.
 *
 * The skybox renders after the opaque pass and is depth-tested against the
 * scene, so solid geometry occludes it; it fills only the pixels no opaque
 * surface covered. Its color is written into the camera's HDR intermediate
 * (when `hdr: true`) so it is tonemapped alongside the rest of the frame.
 *
 * `image` must reference a cube {@link Image} (six faces, `dimension: 'cube'`).
 * The same handle can feed an `EnvironmentMapLight` so one environment asset
 * both lights the scene and appears behind it.
 *
 * @example
 * ```ts
 * import { Camera3d, Skybox } from '@retro-engine/engine';
 * const sky = images.add(skyCubeImage);
 * cmd.spawn(...Camera3d({ hdr: true }), new Skybox({ image: sky }));
 * ```
 */
export class Skybox {
  /** Cube image sampled as the background. Must be a six-face cube texture. */
  image: Handle<Image>;
  /** Linear multiplier applied to the sampled color. `1` leaves the asset unchanged. */
  brightness: number;
  /** World-space rotation applied to the sampling direction — spin the sky without re-authoring the asset. */
  rotation: Quat;

  constructor(options: { image: Handle<Image>; brightness?: number; rotation?: Quat }) {
    this.image = options.image;
    this.brightness = options.brightness ?? 1;
    this.rotation = options.rotation ?? quat.identity();
  }
}
