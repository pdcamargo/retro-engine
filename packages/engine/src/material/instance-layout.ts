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
