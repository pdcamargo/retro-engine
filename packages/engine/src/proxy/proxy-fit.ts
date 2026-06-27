import type { ProxyFitting } from './proxy-fitting';

/**
 * Fit a garment onto a body: compute each proxy vertex's world position from the
 * base mesh and the {@link ProxyFitting} binding —
 * `pos = Σ baryᵢ·base[triᵢ] + (sx·dx, sy·dy, sz·dz)` — writing into `out` (or a
 * fresh `count × 3` array).
 *
 * The per-axis scale `(sx, sy, sz)` is `|base[v1] − base[v2]| / den` for each
 * `x/y/z_scale` reference, so a garment's standoff tracks the body's proportions;
 * with no scale block it is `1`. Because the binding rides the base mesh's
 * triangles, re-fitting after a body morph makes the garment follow the new
 * *shape* — the point of proxy fitting (ADR-0133). Pure and allocation-free when
 * `out` is supplied; cost is `O(proxy vertex count)`.
 *
 * The fitting must be aligned to `basePositions` (its triangle indices address
 * that base mesh); a stray index reads past the array and yields `NaN` for that
 * vertex rather than corrupting its neighbours.
 *
 * @param basePositions the (possibly morphed) body positions, `baseVertexCount × 3`.
 */
export const fitProxy = (
  basePositions: Float32Array,
  fitting: ProxyFitting,
  out?: Float32Array,
): Float32Array => {
  const n = fitting.count;
  const result = out ?? new Float32Array(n * 3);
  const { triIndices, baryWeights, offsets, scale } = fitting;

  let sx = 1;
  let sy = 1;
  let sz = 1;
  if (scale !== undefined) {
    sx = Math.abs(basePositions[scale.x.v1 * 3]! - basePositions[scale.x.v2 * 3]!) / scale.x.den;
    sy = Math.abs(basePositions[scale.y.v1 * 3 + 1]! - basePositions[scale.y.v2 * 3 + 1]!) / scale.y.den;
    sz = Math.abs(basePositions[scale.z.v1 * 3 + 2]! - basePositions[scale.z.v2 * 3 + 2]!) / scale.z.den;
  }

  for (let i = 0; i < n; i++) {
    const a = triIndices[i * 3]! * 3;
    const b = triIndices[i * 3 + 1]! * 3;
    const c = triIndices[i * 3 + 2]! * 3;
    const wa = baryWeights[i * 3]!;
    const wb = baryWeights[i * 3 + 1]!;
    const wc = baryWeights[i * 3 + 2]!;
    result[i * 3] = wa * basePositions[a]! + wb * basePositions[b]! + wc * basePositions[c]! + sx * offsets[i * 3]!;
    result[i * 3 + 1] =
      wa * basePositions[a + 1]! + wb * basePositions[b + 1]! + wc * basePositions[c + 1]! + sy * offsets[i * 3 + 1]!;
    result[i * 3 + 2] =
      wa * basePositions[a + 2]! + wb * basePositions[b + 2]! + wc * basePositions[c + 2]! + sz * offsets[i * 3 + 2]!;
  }
  return result;
};
