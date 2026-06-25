import type { Entity } from '@retro-engine/ecs';
import { mat4 } from '@retro-engine/math';
import type { Mat4 } from '@retro-engine/math';

import type { SkinnedMeshPalette } from './skeleton';

const IDENTITY = mat4.identity();
const tmp = mat4.create();
const meshInverse = mat4.create();

/**
 * Compute one skinned entity's joint palette into `out.data`.
 *
 * For each joint: `palette[i] = inverse(meshGlobal) · jointGlobal[i] ·
 * inverseBind[i]`. The mesh-inverse factor cancels the per-instance model
 * matrix the vertex shader applies, so the blended result lands in world space.
 * A joint whose world matrix or inverse bind is missing gets an identity slot,
 * leaving that influence as a no-op rather than collapsing the vertex.
 */
export const computeSkinningPalette = (
  meshGlobal: Mat4,
  jointGlobals: readonly (Mat4 | undefined)[],
  inverseBindMatrices: readonly Mat4[],
  out: SkinnedMeshPalette,
): void => {
  mat4.inverse(meshGlobal, meshInverse);
  const n = out.jointCount;
  for (let i = 0; i < n; i++) {
    const jg = jointGlobals[i];
    const ibm = inverseBindMatrices[i];
    if (jg === undefined || ibm === undefined) {
      out.data.set(IDENTITY, i * 16);
      continue;
    }
    mat4.multiply(jg, ibm, tmp);
    mat4.multiply(meshInverse, tmp, tmp);
    out.data.set(tmp, i * 16);
  }
};

/**
 * Per-entity joint palettes for the current frame, keyed by the skinned mesh
 * entity. A main-world resource filled in `postUpdate` after transform
 * propagation and read by the render-side palette upload. Transient — entries
 * are overwritten each frame and dropped when a skinned entity goes away.
 */
export class SkinnedPalettes {
  readonly byEntity = new Map<Entity, SkinnedMeshPalette>();
}
