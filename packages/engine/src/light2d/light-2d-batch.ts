import type { Entity } from '@retro-engine/ecs';
import type { Mat4, Vec3 } from '@retro-engine/math';

import type { AmbientLight2d } from './ambient-light-2d';
import type { DirectionalLight2d } from './directional-light-2d';
import type { PointLight2d } from './point-light-2d';
import type { SpotLight2d } from './spot-light-2d';

/**
 * Per-instance discriminator selecting which falloff the accumulation shader
 * applies. Packed as the trailing `f32` of every light instance and read back
 * in WGSL via `u32(kind + 0.5)`.
 *
 * @internal
 */
export const Light2dKind = {
  Point: 0,
  Spot: 1,
  Directional: 2,
  AmbientZone: 3,
} as const;

/**
 * Per-instance byte size for a packed 2D light. Three `float32x4` slots plus a
 * trailing `f32` kind discriminator:
 *
 * | bytes  | f32 slot | format    | `@location` | content                                  |
 * |--------|----------|-----------|-------------|------------------------------------------|
 * | 0..15  | 0..3     | float32x4 | 2           | `center.xy` + `(range, radius)` / `(halfW, halfH)` |
 * | 16..31 | 4..7     | float32x4 | 3           | `color.rgb + intensity`                  |
 * | 32..47 | 8..11    | float32x4 | 4           | spot cone `dir.xy + cosInner + cosOuter` |
 * | 48..51 | 12       | float32   | 5           | `kind` ({@link Light2dKind})             |
 *
 * The vertex shader reads four `@location()` attributes summing to 52 bytes;
 * the pipeline's `arrayStride` must equal this constant.
 *
 * @internal
 */
export const LIGHT2D_INSTANCE_BYTE_SIZE = 52 as const;

/** 13 = `LIGHT2D_INSTANCE_BYTE_SIZE / 4`. */
export const LIGHT2D_INSTANCE_FLOAT_COUNT = 13 as const;

/**
 * Per-camera per-frame batch record produced by the lighting queue system.
 *
 * Each Core2d camera that has any visible lights produces one batch — the
 * accumulation pipeline samples no per-light texture, so every light (of any
 * kind) can draw in one instanced call. The batch's `firstInstance` is its
 * starting offset within {@link Light2dInstanceBuffer}; `count` is the number
 * of lights packed for this camera.
 *
 * @internal
 */
export interface Light2dBatch {
  readonly sourceEntity: Entity;
  readonly firstInstance: number;
  readonly count: number;
}

/**
 * Render-world resource holding the per-frame list of {@link Light2dBatch}es.
 * Populated by the lighting plugin's queue system, consumed by the
 * accumulation pass node. Cleared at the start of every queue pass.
 *
 * @internal
 */
export class Light2dPreparedBatches {
  batches: Light2dBatch[] = [];

  forCamera(sourceEntity: Entity): Light2dBatch | undefined {
    for (const batch of this.batches) {
      if (batch.sourceEntity === sourceEntity) return batch;
    }
    return undefined;
  }
}

const writeColorIntensity = (
  f32View: Float32Array,
  floatIndex: number,
  color: Vec3,
  intensity: number,
): void => {
  f32View[floatIndex + 4] = color[0] as number;
  f32View[floatIndex + 5] = color[1] as number;
  f32View[floatIndex + 6] = color[2] as number;
  f32View[floatIndex + 7] = intensity;
};

/**
 * Pack one {@link PointLight2d} into `f32View` at the supplied float index.
 * Returns the number of f32 slots consumed ({@link LIGHT2D_INSTANCE_FLOAT_COUNT}).
 * The world-space centre comes from the entity's `GlobalTransform` translation
 * column.
 *
 * @internal
 */
export const packLightInstance = (
  light: PointLight2d,
  gtMatrix: Mat4,
  f32View: Float32Array,
  floatIndex: number,
): number => {
  f32View[floatIndex + 0] = gtMatrix[12] as number;
  f32View[floatIndex + 1] = gtMatrix[13] as number;
  f32View[floatIndex + 2] = light.range;
  f32View[floatIndex + 3] = light.radius;
  writeColorIntensity(f32View, floatIndex, light.color, light.intensity);
  // Cone slot unused for point lights.
  f32View[floatIndex + 8] = 0;
  f32View[floatIndex + 9] = 0;
  f32View[floatIndex + 10] = 0;
  f32View[floatIndex + 11] = 0;
  f32View[floatIndex + 12] = Light2dKind.Point;
  return LIGHT2D_INSTANCE_FLOAT_COUNT;
};

/**
 * Pack one {@link SpotLight2d}. Reuses the point radial footprint
 * (`range`/`radius`) and adds the cone: the normalized direction and the
 * cosines of the inner / outer half-angles, consumed by the accumulation
 * shader's angular `smoothstep`.
 *
 * @internal
 */
export const packSpotLightInstance = (
  light: SpotLight2d,
  gtMatrix: Mat4,
  f32View: Float32Array,
  floatIndex: number,
): number => {
  f32View[floatIndex + 0] = gtMatrix[12] as number;
  f32View[floatIndex + 1] = gtMatrix[13] as number;
  f32View[floatIndex + 2] = light.range;
  f32View[floatIndex + 3] = light.radius;
  writeColorIntensity(f32View, floatIndex, light.color, light.intensity);
  const dx = light.direction[0] as number;
  const dy = light.direction[1] as number;
  const len = Math.hypot(dx, dy) || 1;
  f32View[floatIndex + 8] = dx / len;
  f32View[floatIndex + 9] = dy / len;
  f32View[floatIndex + 10] = Math.cos(light.innerAngle);
  f32View[floatIndex + 11] = Math.cos(light.outerAngle);
  f32View[floatIndex + 12] = Light2dKind.Spot;
  return LIGHT2D_INSTANCE_FLOAT_COUNT;
};

/**
 * Pack one {@link DirectionalLight2d}. Emitted as a full-screen flat add — no
 * positional footprint. The direction is carried in the cone slot for the
 * normal-aware lit path; without normal maps it is a uniform wash.
 *
 * @internal
 */
export const packDirectionalLightInstance = (
  light: DirectionalLight2d,
  f32View: Float32Array,
  floatIndex: number,
): number => {
  f32View[floatIndex + 0] = 0;
  f32View[floatIndex + 1] = 0;
  f32View[floatIndex + 2] = 0;
  f32View[floatIndex + 3] = 0;
  writeColorIntensity(f32View, floatIndex, light.color, light.intensity);
  const dx = light.direction[0] as number;
  const dy = light.direction[1] as number;
  const len = Math.hypot(dx, dy) || 1;
  f32View[floatIndex + 8] = dx / len;
  f32View[floatIndex + 9] = dy / len;
  f32View[floatIndex + 10] = 0;
  f32View[floatIndex + 11] = 0;
  f32View[floatIndex + 12] = Light2dKind.Directional;
  return LIGHT2D_INSTANCE_FLOAT_COUNT;
};

/**
 * Pack one bounded {@link AmbientLight2d} zone as a world-space rectangle
 * centred on the entity's `GlobalTransform`, with the zone half-extents in the
 * footprint slot. A flat add inside the rect.
 *
 * @internal
 */
export const packAmbientLightInstance = (
  light: AmbientLight2d,
  gtMatrix: Mat4,
  halfWidth: number,
  halfHeight: number,
  f32View: Float32Array,
  floatIndex: number,
): number => {
  f32View[floatIndex + 0] = gtMatrix[12] as number;
  f32View[floatIndex + 1] = gtMatrix[13] as number;
  f32View[floatIndex + 2] = halfWidth;
  f32View[floatIndex + 3] = halfHeight;
  writeColorIntensity(f32View, floatIndex, light.color, light.intensity);
  f32View[floatIndex + 8] = 0;
  f32View[floatIndex + 9] = 0;
  f32View[floatIndex + 10] = 0;
  f32View[floatIndex + 11] = 0;
  f32View[floatIndex + 12] = Light2dKind.AmbientZone;
  return LIGHT2D_INSTANCE_FLOAT_COUNT;
};
