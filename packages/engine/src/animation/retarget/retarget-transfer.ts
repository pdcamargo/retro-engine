import type { Mat4, Quat, Vec3 } from '@retro-engine/math';
import { mat4, quat, vec3 } from '@retro-engine/math';

/** How a retarget treats the hip/root bone's translation across a proportion gap. */
export type RootTranslationMode = 'targetBindPose' | 'animationScaled';

// Scratch for the body-frame alignment.
const fUp = vec3.create();
const fSide = vec3.create();
const fFwd = vec3.create();
const fBs = mat4.create();
const fBt = mat4.create();
const fBsT = mat4.create();
const fG = mat4.create();

// Build an orthonormal body frame (as a rotation matrix) from bind landmark world
// positions: up = hip→head, side = rightLeg→leftLeg, forward = up × side. Written
// column-major into `out`. Returns false (leaving `out` identity) when the
// landmarks are degenerate — coincident, or up parallel to side.
const bodyFrameInto = (hip: Vec3, head: Vec3, legL: Vec3, legR: Vec3, out: Mat4): boolean => {
  mat4.identity(out);
  vec3.subtract(head, hip, fUp);
  vec3.subtract(legL, legR, fSide);
  if (vec3.length(fUp) < 1e-5 || vec3.length(fSide) < 1e-5) return false;
  vec3.normalize(fUp, fUp);
  vec3.normalize(fSide, fSide);
  vec3.cross(fUp, fSide, fFwd);
  if (vec3.length(fFwd) < 1e-5) return false;
  vec3.normalize(fFwd, fFwd);
  vec3.normalize(vec3.cross(fFwd, fUp, fSide), fSide);
  out[0] = fSide[0]!; out[1] = fSide[1]!; out[2] = fSide[2]!;
  out[4] = fUp[0]!; out[5] = fUp[1]!; out[6] = fUp[2]!;
  out[8] = fFwd[0]!; out[9] = fFwd[1]!; out[10] = fFwd[2]!;
  return true;
};

/**
 * The global rotation that aligns the **source** rig's bind orientation to the
 * **target's**, derived from each rig's bind-pose body frame (built from hip,
 * head, and upper-leg world positions — position-based, so it is immune to the
 * per-bone local-axis conventions two exports may disagree on). The rest-relative
 * rotation transfer assumes both rigs share an auxiliary pose orientation; when an
 * animation pack is authored facing a different way (or in a different up-axis)
 * than the target, this `G` re-bases the source's world rotations into the
 * target's frame so the motion lands upright. Falls back to identity when the
 * landmarks are too degenerate to form a frame.
 */
export const bodyFrameAlignment = (
  srcHip: Vec3,
  srcHead: Vec3,
  srcLegL: Vec3,
  srcLegR: Vec3,
  tgtHip: Vec3,
  tgtHead: Vec3,
  tgtLegL: Vec3,
  tgtLegR: Vec3,
  out: Quat,
): Quat => {
  const okS = bodyFrameInto(srcHip, srcHead, srcLegL, srcLegR, fBs);
  const okT = bodyFrameInto(tgtHip, tgtHead, tgtLegL, tgtLegR, fBt);
  if (!okS || !okT) return quat.identity(out);
  mat4.transpose(fBs, fBsT);
  mat4.multiply(fBt, fBsT, fG); // G = Bt · Bsᵀ maps source-world vectors → target-world
  quat.fromMat(fG, out);
  return quat.normalize(out, out);
};

// Scratch reused by the transfer helpers — retargeting is single-threaded.
const A = quat.create();
const B = quat.create();

/**
 * Build the constant left/right rotations that re-base a source bone's animated
 * **local** rotation onto a target bone, given both rigs' rest **world**
 * rotations. The transfer is `target = A · srcLocal · B`, where
 * `A = tgtParentRest⁻¹ · srcParentRest` and `B = srcRest⁻¹ · tgtRest`. This
 * preserves the bone's world-space rotation *delta from its own bind* across the
 * two skeletons, so motion crosses rigs that rest in different orientations — the
 * standard per-bind retarget (three.js / Unreal IK-Rig). `A`/`B` are constant per
 * bone, so a clip bake computes them once and applies them to every keyframe.
 */
export const retargetRotationFactors = (
  srcParentRestWorldR: Quat,
  srcRestWorldR: Quat,
  tgtParentRestWorldR: Quat,
  tgtRestWorldR: Quat,
  outA: Quat,
  outB: Quat,
): void => {
  quat.inverse(tgtParentRestWorldR, outA);
  quat.multiply(outA, srcParentRestWorldR, outA);
  quat.inverse(srcRestWorldR, outB);
  quat.multiply(outB, tgtRestWorldR, outB);
};

/** Apply precomputed factors: `out = A · srcLocalAnim · B`. */
export const applyRetargetFactors = (a: Quat, srcLocalAnim: Quat, b: Quat, out: Quat): Quat => {
  quat.multiply(a, srcLocalAnim, out);
  quat.multiply(out, b, out);
  return out;
};

/**
 * Transfer a source bone's animated **local** rotation onto a target bone,
 * re-based through both rigs' rest world rotations (see
 * {@link retargetRotationFactors}). Convenience wrapper that builds the factors
 * and applies them in one call; the clip bake uses the split form to avoid
 * rebuilding the factors per keyframe. For rigs that share a bind orientation
 * this reduces to copying the source rotation outright.
 */
export const transferRotation = (
  srcParentRestWorldR: Quat,
  srcRestWorldR: Quat,
  srcLocalAnim: Quat,
  tgtParentRestWorldR: Quat,
  tgtRestWorldR: Quat,
  out: Quat,
): Quat => {
  retargetRotationFactors(srcParentRestWorldR, srcRestWorldR, tgtParentRestWorldR, tgtRestWorldR, A, B);
  return applyRetargetFactors(A, srcLocalAnim, B, out);
};

/**
 * The height/proportion ratio between two rigs, from their hip rest **world**
 * heights (`target ÷ source`). Root translation is scaled by this so a taller
 * target steps proportionally further. Falls back to `1` if the source height
 * is degenerate.
 */
export const proportionRatio = (srcHipWorldY: number, tgtHipWorldY: number): number => {
  if (Math.abs(srcHipWorldY) < 1e-6) return 1;
  return tgtHipWorldY / srcHipWorldY;
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
