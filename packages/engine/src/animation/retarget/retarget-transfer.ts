import type { Quat, Vec3 } from '@retro-engine/math';
import { quat, vec3 } from '@retro-engine/math';

/** How a retarget treats the hip/root bone's translation across a proportion gap. */
export type RootTranslationMode = 'targetBindPose' | 'animationScaled';

// Scratch reused by the transfer helpers — retargeting is single-threaded.
const A = quat.create();
const B = quat.create();

/**
 * Build the constant left/right rotations that re-base a source bone's animated
 * **local** rotation onto a target bone, given both rigs' **reference-pose** world
 * rotations (the shared canonical pose each rig is posed into). The transfer is
 * `target = A · srcLocal · B`, where `A = tgtParentRef⁻¹ · srcParentRef` and
 * `B = srcRef⁻¹ · tgtRef`. Because both rigs share the reference pose, this
 * reproduces the source's pose on the target *relative to that shared zero* — at
 * the source's rest the target shows the source's rest shape, not its own bind —
 * so motion crosses rigs that rest in different bind poses (A-pose vs T-pose).
 * The world-FK terms telescope away, leaving this exact per-bone form. `A`/`B`
 * are constant per bone, so a clip bake computes them once and applies them to
 * every keyframe.
 */
export const retargetRotationFactors = (
  srcParentRefWorldR: Quat,
  srcRefWorldR: Quat,
  tgtParentRefWorldR: Quat,
  tgtRefWorldR: Quat,
  outA: Quat,
  outB: Quat,
): void => {
  quat.inverse(tgtParentRefWorldR, outA);
  quat.multiply(outA, srcParentRefWorldR, outA);
  quat.inverse(srcRefWorldR, outB);
  quat.multiply(outB, tgtRefWorldR, outB);
};

/** Apply precomputed factors: `out = A · srcLocalAnim · B`. */
export const applyRetargetFactors = (a: Quat, srcLocalAnim: Quat, b: Quat, out: Quat): Quat => {
  quat.multiply(a, srcLocalAnim, out);
  quat.multiply(out, b, out);
  return out;
};

/**
 * Transfer a source bone's animated **local** rotation onto a target bone,
 * re-based through both rigs' reference-pose world rotations (see
 * {@link retargetRotationFactors}). Convenience wrapper that builds the factors
 * and applies them in one call; the clip bake uses the split form to avoid
 * rebuilding the factors per keyframe. For rigs whose reference poses coincide
 * this reduces to copying the source rotation outright.
 */
export const transferRotation = (
  srcParentRefWorldR: Quat,
  srcRefWorldR: Quat,
  srcLocalAnim: Quat,
  tgtParentRefWorldR: Quat,
  tgtRefWorldR: Quat,
  out: Quat,
): Quat => {
  retargetRotationFactors(srcParentRefWorldR, srcRefWorldR, tgtParentRefWorldR, tgtRefWorldR, A, B);
  return applyRetargetFactors(A, srcLocalAnim, B, out);
};

/**
 * The height/proportion ratio between two rigs, from their hip rest heights
 * (`target ÷ source`) — each the hip's distance from the skeleton root. Root
 * translation is scaled by this so a taller target steps proportionally further.
 * Falls back to `1` if the source height is degenerate.
 */
export const proportionRatio = (srcHipHeight: number, tgtHipHeight: number): number => {
  if (Math.abs(srcHipHeight) < 1e-6) return 1;
  return tgtHipHeight / srcHipHeight;
};

const deltaV = vec3.create();

/**
 * Resolve the target hip/root **local** translation for one keyframe.
 *
 * - `targetBindPose` — keep the target's rest translation (no root motion).
 * - `animationScaled` — keep the target's rest stance and add the source's motion
 *   *delta from its rest*, re-based into the target's parent frame by `frameRot`
 *   (the rotation aligning the source hip-parent frame to the target's) and
 *   scaled by the proportion `ratio`, so root motion travels in the target's
 *   space and in proportion to its size.
 */
export const scaleRootTranslation = (
  srcRestT: Vec3,
  srcAnimT: Vec3,
  tgtRestT: Vec3,
  ratio: number,
  frameRot: Quat,
  mode: RootTranslationMode,
  out: Vec3,
): Vec3 => {
  if (mode === 'targetBindPose') {
    vec3.copy(tgtRestT, out);
    return out;
  }
  vec3.subtract(srcAnimT, srcRestT, deltaV);
  vec3.transformQuat(deltaV, frameRot, deltaV);
  out[0] = tgtRestT[0]! + ratio * deltaV[0]!;
  out[1] = tgtRestT[1]! + ratio * deltaV[1]!;
  out[2] = tgtRestT[2]! + ratio * deltaV[2]!;
  return out;
};
