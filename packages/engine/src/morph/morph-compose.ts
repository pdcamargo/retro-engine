import type { SparseMorphTarget } from './sparse-morph-target';

/** One weighted contribution to a composed mesh: a sparse target and its slider weight. */
export interface WeightedMorphTarget {
  readonly target: SparseMorphTarget;
  readonly weight: number;
}

/**
 * Compose base positions with a set of weighted sparse morph targets, writing the
 * result into `out` (or a fresh array): `out[v] = base[v] + Σ weightᵢ · deltaᵢ[v]`.
 *
 * Sparse-efficient — each target only touches the vertices it moves, so cost is
 * `Σ targetᵢ.count`, not `vertexCount × targetCount`. Zero-weight targets are
 * skipped. This is the edit-time character-creator composition: drag a slider,
 * recompose, re-upload the mesh — no runtime/GPU morph cost (ADR-0131).
 *
 * Targets must be aligned to the base (`target.fitsBase(vertexCount)`); an index
 * past the base vertex count is skipped rather than corrupting adjacent vertices,
 * so a mismatched target degrades to no-op on its stray vertices instead of
 * throwing mid-compose.
 *
 * @param basePositions the base mesh positions, `vertexCount × 3` floats.
 */
export const composeMorphedPositions = (
  basePositions: Float32Array,
  contributions: readonly WeightedMorphTarget[],
  out?: Float32Array,
): Float32Array => {
  const result = out ?? new Float32Array(basePositions.length);
  if (result !== basePositions) result.set(basePositions);
  const vertexCount = basePositions.length / 3;
  for (const { target, weight } of contributions) {
    if (weight === 0) continue;
    const { indices, deltas } = target;
    for (let i = 0; i < indices.length; i++) {
      const v = indices[i]!;
      if (v >= vertexCount) continue;
      result[v * 3] = result[v * 3]! + weight * deltas[i * 3]!;
      result[v * 3 + 1] = result[v * 3 + 1]! + weight * deltas[i * 3 + 1]!;
      result[v * 3 + 2] = result[v * 3 + 2]! + weight * deltas[i * 3 + 2]!;
    }
  }
  return result;
};
