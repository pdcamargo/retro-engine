import type { Mat4 } from '@retro-engine/math';
import type { VertexBufferLayout } from '@retro-engine/renderer-core';

import {
  INSTANCE_LAYOUT,
  MESH_INSTANCE_BYTE_SIZE,
  MESH_INSTANCE_FLOAT_COUNT,
  packInstanceTransform,
} from '../material/instance-layout';

/**
 * `@location` of the per-instance joint-palette base index. WebGPU guarantees
 * only 16 vertex attributes (valid locations `0..15`), so the index cannot sit
 * above the instance transform block at `8..15`. The skinned mesh attributes
 * take `0..6` (position, normal, uv, joint index, joint weight, and optionally
 * tangent/color), leaving location `7` free on every skinned pipeline — and
 * skinned meshes never run the motion-vector prepass, the only other consumer
 * of `4..7`, so there is no collision. It lives in the instance stream (vertex
 * slot 1) since it is per-instance data, just at a non-contiguous location.
 */
export const SKINNED_JOINT_OFFSET_LOCATION = 7 as const;

/**
 * Byte size of one packed skinned instance: the 128-byte rigid instance (model
 * + inverse-transpose) followed by a `u32` joint-palette base index. Padded to
 * a 4-byte multiple at 132 bytes.
 */
export const SKINNED_INSTANCE_BYTE_SIZE: number = MESH_INSTANCE_BYTE_SIZE + 4;

/** `SKINNED_INSTANCE_BYTE_SIZE / 4` — 4-byte slots per skinned instance. */
export const SKINNED_INSTANCE_FLOAT_COUNT: number = MESH_INSTANCE_FLOAT_COUNT + 1;

/**
 * Per-instance vertex buffer layout for skinned mesh draws (`stepMode:
 * 'instance'`, bound at vertex slot 1). The eight `float32x4` transform columns
 * of {@link INSTANCE_LAYOUT} at `8..15`, plus a `uint32` joint-palette base
 * index at {@link SKINNED_JOINT_OFFSET_LOCATION}. The skinned vertex shader adds
 * `joint_offset` to each per-vertex joint index to read the entity's slice of
 * the shared palette buffer.
 */
export const SKINNED_INSTANCE_LAYOUT: VertexBufferLayout = {
  arrayStride: SKINNED_INSTANCE_BYTE_SIZE,
  stepMode: 'instance',
  attributes: [
    ...INSTANCE_LAYOUT.attributes,
    {
      shaderLocation: SKINNED_JOINT_OFFSET_LOCATION,
      format: 'uint32' as const,
      offset: MESH_INSTANCE_BYTE_SIZE,
    },
  ],
};

/**
 * Write one skinned instance into the shared scratch at slot offset
 * `cursorSlots`: the model matrix + inverse-transpose (32 floats), then the
 * joint-palette base index as a `u32` in the 33rd slot. `f32` and `u32` must
 * view the same buffer. Returns {@link SKINNED_INSTANCE_FLOAT_COUNT} so callers
 * can advance the cursor.
 */
export const packSkinnedInstance = (
  f32: Float32Array,
  u32: Uint32Array,
  cursorSlots: number,
  model: Mat4,
  jointOffset: number,
): number => {
  packInstanceTransform(f32, cursorSlots, model);
  u32[cursorSlots + MESH_INSTANCE_FLOAT_COUNT] = jointOffset;
  return SKINNED_INSTANCE_FLOAT_COUNT;
};
