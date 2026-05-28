import type { Mat4 } from '@retro-engine/math';
import { mat4 } from '@retro-engine/math';
import type { VertexBufferLayout } from '@retro-engine/renderer-core';

/**
 * Byte size of one packed mesh instance: a `mat4x4<f32>` model matrix followed
 * by its inverse-transpose (for transforming normals without scale skew).
 * Two 64-byte matrices = 128 bytes.
 */
export const MESH_INSTANCE_BYTE_SIZE = 128 as const;

/** `MESH_INSTANCE_BYTE_SIZE / 4` — float slots per instance. */
export const MESH_INSTANCE_FLOAT_COUNT = 32 as const;

/**
 * First `@location` the per-instance transform attributes occupy. Mesh vertex
 * attributes take locations `0..N-1` (POSITION, NORMAL, UV, TANGENT, COLOR —
 * at most five), so starting the instance block at 8 leaves a collision-free
 * gap and keeps the highest location (15) within the 16-attribute floor every
 * backend guarantees.
 *
 * Locations `8..11` are the four columns of the model matrix; `12..15` are the
 * four columns of the inverse-transpose model matrix.
 */
export const INSTANCE_TRANSFORM_BASE_LOCATION = 8 as const;

/**
 * Per-instance vertex buffer layout for mesh-material draws (`stepMode:
 * 'instance'`, bound at vertex slot 1). Eight `float32x4` columns: the model
 * matrix at locations `8..11`, its inverse-transpose at `12..15`.
 *
 * A material's vertex shader declares only the columns it reads (unlit needs
 * the model matrix; lit shaders also read the inverse-transpose) — declaring
 * vertex attributes the shader does not consume is valid, so one layout serves
 * every mesh material.
 */
export const INSTANCE_LAYOUT: VertexBufferLayout = {
  arrayStride: MESH_INSTANCE_BYTE_SIZE,
  stepMode: 'instance',
  attributes: Array.from({ length: 8 }, (_unused, i) => ({
    shaderLocation: INSTANCE_TRANSFORM_BASE_LOCATION + i,
    format: 'float32x4' as const,
    offset: i * 16,
  })),
};

const scratchInverse = mat4.identity();

/**
 * Write one instance's transform into `scratch` starting at float offset
 * `cursorFloats`: the `model` matrix (16 floats), then its inverse-transpose
 * (16 floats). Returns {@link MESH_INSTANCE_FLOAT_COUNT}, the number of floats
 * written, so callers can advance the cursor.
 */
export const packInstanceTransform = (
  scratch: Float32Array,
  cursorFloats: number,
  model: Mat4,
): number => {
  scratch.set(model as Float32Array, cursorFloats);
  mat4.invert(model, scratchInverse);
  mat4.transpose(scratchInverse, scratchInverse);
  scratch.set(scratchInverse as Float32Array, cursorFloats + 16);
  return MESH_INSTANCE_FLOAT_COUNT;
};

/**
 * Byte size of one packed previous-frame instance matrix: a single
 * `mat4x4<f32>` model matrix from the previous rendered frame, used by the
 * motion-vector prepass to reconstruct the previous-frame clip position
 * alongside the current. 64 bytes.
 *
 * No inverse-transpose lives in the previous-instance stream — motion-vector
 * reconstruction only needs the previous clip-space position, not normal
 * transforms — so the previous-instance stride is half the current one.
 */
export const PREVIOUS_INSTANCE_BYTE_SIZE = 64 as const;

/** `PREVIOUS_INSTANCE_BYTE_SIZE / 4` — float slots per previous-frame instance. */
export const PREVIOUS_INSTANCE_FLOAT_COUNT = 16 as const;

/**
 * First `@location` the previous-instance transform attributes occupy.
 * Sits just past the current-frame block (locations 8..15) so the standard
 * 16-attribute floor holds: `16..19` are the four columns of the previous
 * model matrix.
 */
export const PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION = 16 as const;

/**
 * Per-instance vertex buffer layout carrying each entity's *previous*-frame
 * model matrix (`stepMode: 'instance'`, bound at vertex slot 2). Four
 * `float32x4` columns at locations `16..19`. Only attached to the prepass
 * pipeline when its camera has `MotionVectorPrepass` active and its material
 * opts into the motion-vector channel via `prepassWrites()`; absent
 * otherwise so opaque / non-motion prepass draws pay nothing for it.
 *
 * The packer ordering matches {@link INSTANCE_LAYOUT}'s in lockstep so a
 * single `firstInstance + count` slice indexes both buffers.
 */
export const PREVIOUS_INSTANCE_LAYOUT: VertexBufferLayout = {
  arrayStride: PREVIOUS_INSTANCE_BYTE_SIZE,
  stepMode: 'instance',
  attributes: Array.from({ length: 4 }, (_unused, i) => ({
    shaderLocation: PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION + i,
    format: 'float32x4' as const,
    offset: i * 16,
  })),
};

/**
 * Write one instance's previous-frame model matrix into `scratch` starting
 * at float offset `cursorFloats` (16 floats). Returns
 * {@link PREVIOUS_INSTANCE_FLOAT_COUNT} so callers can advance the cursor
 * in lockstep with {@link packInstanceTransform}.
 */
export const packPreviousInstanceTransform = (
  scratch: Float32Array,
  cursorFloats: number,
  previousModel: Mat4,
): number => {
  scratch.set(previousModel as Float32Array, cursorFloats);
  return PREVIOUS_INSTANCE_FLOAT_COUNT;
};
