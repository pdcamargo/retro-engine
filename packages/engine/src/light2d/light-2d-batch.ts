import type { Entity } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';

import type { PointLight2d } from './point-light-2d';

/**
 * Per-instance byte size for a packed `PointLight2d`. Two `float32x4` slots:
 *
 * | bytes  | f32 slot | format    | `@location` | content                       |
 * |--------|----------|-----------|-------------|-------------------------------|
 * | 0..15  | 0..3     | float32x4 | 2           | `center.xy + range + radius`  |
 * | 16..31 | 4..7     | float32x4 | 3           | `color.rgb + intensity`       |
 *
 * The vertex shader reads two `@location()` attributes summing to 32 bytes;
 * the pipeline's `arrayStride` must equal this constant.
 *
 * @internal
 */
export const LIGHT2D_INSTANCE_BYTE_SIZE = 32 as const;

/** 8 = `LIGHT2D_INSTANCE_BYTE_SIZE / 4`. */
export const LIGHT2D_INSTANCE_FLOAT_COUNT = 8 as const;

/**
 * Per-camera per-frame batch record produced by the lighting queue system.
 *
 * Each Core2d camera that has any visible lights produces one batch — the
 * accumulation pipeline samples no per-light texture, so every light can
 * draw in one instanced call. The batch's `firstInstance` is its starting
 * offset within {@link Light2dInstanceBuffer}; `count` is the number of
 * lights packed for this camera.
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

/**
 * Pack one light's per-instance data into `f32View` at the supplied float
 * index. Returns the number of f32 slots consumed
 * ({@link LIGHT2D_INSTANCE_FLOAT_COUNT}). The world-space centre comes from
 * the entity's `GlobalTransform` translation column.
 *
 * @internal
 */
export const packLightInstance = (
  light: PointLight2d,
  gtMatrix: Mat4,
  f32View: Float32Array,
  floatIndex: number,
): number => {
  const tx = gtMatrix[12] as number;
  const ty = gtMatrix[13] as number;

  f32View[floatIndex + 0] = tx;
  f32View[floatIndex + 1] = ty;
  f32View[floatIndex + 2] = light.range;
  f32View[floatIndex + 3] = light.radius;

  f32View[floatIndex + 4] = light.color[0] as number;
  f32View[floatIndex + 5] = light.color[1] as number;
  f32View[floatIndex + 6] = light.color[2] as number;
  f32View[floatIndex + 7] = light.intensity;

  return LIGHT2D_INSTANCE_FLOAT_COUNT;
};
