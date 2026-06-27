import type { MorphTargets } from './morph-targets';

/**
 * Floats per packed morph delta: a `vec3<f32>` position delta and a `vec3<f32>`
 * normal delta, each padded to a 16-byte (4-float) boundary to satisfy std430
 * struct alignment. Position occupies floats 0–2, normal floats 4–6 of each
 * 8-float record; floats 3 and 7 are padding.
 */
export const MORPH_DELTA_FLOATS = 8;

/**
 * Pack a mesh's morph targets into the std430 layout the morph storage buffer
 * uses: target-major (`record[target · vertexCount + vertex]`), each record a
 * padded position delta followed by a padded normal delta.
 *
 * Pure — no GPU dependency — so it is unit-testable and benchable. Cost grows
 * with `targetCount × vertexCount`, which is why it lives behind a one-shot
 * upload rather than the per-frame path.
 */
export const packMorphDeltas = (morph: MorphTargets): Float32Array => {
  const vertexCount = morph.vertexCount;
  const targetCount = morph.count;
  const packed = new Float32Array(targetCount * vertexCount * MORPH_DELTA_FLOATS);
  for (let t = 0; t < targetCount; t++) {
    const target = morph.targets[t]!;
    const pos = target.positionDeltas;
    const nrm = target.normalDeltas;
    for (let v = 0; v < vertexCount; v++) {
      const base = (t * vertexCount + v) * MORPH_DELTA_FLOATS;
      packed[base] = pos[v * 3]!;
      packed[base + 1] = pos[v * 3 + 1]!;
      packed[base + 2] = pos[v * 3 + 2]!;
      packed[base + 4] = nrm[v * 3]!;
      packed[base + 5] = nrm[v * 3 + 1]!;
      packed[base + 6] = nrm[v * 3 + 2]!;
    }
  }
  return packed;
};
