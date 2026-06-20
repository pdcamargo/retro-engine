import type { Handle } from '@retro-engine/assets';
import { quat } from '@retro-engine/math';
import type { Quat } from '@retro-engine/math';

import type { Image } from '../image/image';

/**
 * Per-camera component lighting the scene from an environment cubemap
 * (image-based lighting). The engine prefilters the referenced cube into a
 * diffuse irradiance map, a roughness-mipped specular map, and a BRDF
 * integration LUT, then feeds them into the PBR shader's indirect term —
 * replacing the flat ambient with environment diffuse + roughness-aware
 * reflections.
 *
 * `environmentMap` must reference a cube {@link Image} (six faces). Pair it with
 * a {@link Skybox} on the same camera that references the same handle to both
 * light from and display one environment — one asset, two consumers.
 *
 * Prefiltering happens once per source image at load (on the GPU, via render
 * passes); the derived maps are runtime-only and never serialized.
 *
 * @example
 * ```ts
 * import { Camera3d, EnvironmentMapLight, Skybox } from '@retro-engine/engine';
 * const env = images.add(skyCubeImage);
 * cmd.spawn(
 *   ...Camera3d({ hdr: true }),
 *   new EnvironmentMapLight({ environmentMap: env }),
 *   new Skybox({ image: env }),
 * );
 * ```
 */
export class EnvironmentMapLight {
  /** Cube image prefiltered for image-based lighting. Must be a six-face cube texture. */
  environmentMap: Handle<Image>;
  /** Overall multiplier applied on top of the per-term diffuse/specular intensities. */
  intensity: number;
  /** Multiplier on the diffuse (irradiance) contribution. */
  diffuseIntensity: number;
  /** Multiplier on the specular (reflection) contribution. */
  specularIntensity: number;
  /** World-space rotation applied to the lookup directions — align the lighting with a rotated skybox. */
  rotation: Quat;

  constructor(options: {
    environmentMap: Handle<Image>;
    intensity?: number;
    diffuseIntensity?: number;
    specularIntensity?: number;
    rotation?: Quat;
  }) {
    this.environmentMap = options.environmentMap;
    this.intensity = options.intensity ?? 1;
    this.diffuseIntensity = options.diffuseIntensity ?? 1;
    this.specularIntensity = options.specularIntensity ?? 1;
    this.rotation = options.rotation ?? quat.identity();
  }
}
