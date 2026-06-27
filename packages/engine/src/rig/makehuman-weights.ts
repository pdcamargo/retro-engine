import type { MakeHumanRig } from './makehuman-rig';

/** Skin attributes for a base mesh: top-4 joint influences per vertex. */
export interface SkinWeights {
  /** `vertexCount × 4` joint indices (into the rig's bone order), for `JOINTS_0`. */
  readonly joints: Uint16Array;
  /** `vertexCount × 4` weights parallel to {@link joints}, normalized per vertex, for `WEIGHTS_0`. */
  readonly weights: Float32Array;
}

const MAX_INFLUENCES = 4;

/**
 * Parse a MakeHuman `weights.<name>.json` into per-vertex skin attributes against
 * a {@link MakeHumanRig}. The document maps each bone to `[vertexIndex, weight]`
 * pairs; this inverts it to per-vertex top-4 influences (by weight), keyed by the
 * rig's joint index and normalized so each vertex's weights sum to 1 (vertices
 * with no influence fall back to joint 0 at full weight). The result feeds the
 * `JOINTS_0` / `WEIGHTS_0` vertex attributes the GPU skinning path consumes.
 */
export const parseMakeHumanWeights = (
  text: string,
  rig: MakeHumanRig,
  baseVertexCount: number,
): SkinWeights => {
  const doc = JSON.parse(text) as { weights?: Record<string, [number, number][]> };
  const table = doc.weights ?? {};

  // Per vertex, accumulate (jointIndex, weight) influences.
  const perVertex: { joint: number; weight: number }[][] = Array.from({ length: baseVertexCount }, () => []);
  for (const [bone, pairs] of Object.entries(table)) {
    const joint = rig.indexOf.get(bone);
    if (joint === undefined || !Array.isArray(pairs)) continue;
    for (const pair of pairs) {
      const v = pair[0];
      const w = pair[1];
      if (!Number.isInteger(v) || v < 0 || v >= baseVertexCount || !(w > 0)) continue;
      perVertex[v]!.push({ joint, weight: w });
    }
  }

  const joints = new Uint16Array(baseVertexCount * 4);
  const weights = new Float32Array(baseVertexCount * 4);
  for (let v = 0; v < baseVertexCount; v++) {
    const infl = perVertex[v]!;
    infl.sort((a, b) => b.weight - a.weight);
    const top = infl.slice(0, MAX_INFLUENCES);
    let sum = 0;
    for (const t of top) sum += t.weight;
    if (sum <= 0) {
      // Unweighted vertex: pin to joint 0 so it still rigid-follows the root.
      joints[v * 4] = 0;
      weights[v * 4] = 1;
      continue;
    }
    for (let k = 0; k < top.length; k++) {
      joints[v * 4 + k] = top[k]!.joint;
      weights[v * 4 + k] = top[k]!.weight / sum;
    }
  }
  return { joints, weights };
};
