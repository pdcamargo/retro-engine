import type { Quat, Vec3 } from '@retro-engine/math';
import { quat, vec3 } from '@retro-engine/math';

/** World-space inputs to {@link solveTwoBone}, sampled from the posed skeleton. */
export interface TwoBoneSolveInput {
  /** World position of the root joint (shoulder / hip). */
  readonly rootPos: Vec3;
  /** World position of the mid joint (elbow / knee). */
  readonly midPos: Vec3;
  /** World position of the tip joint (hand / ankle). */
  readonly tipPos: Vec3;
  /** World position the tip should reach. */
  readonly targetPos: Vec3;
  /**
   * World position of the pole/hint that disambiguates the bend plane: the mid
   * joint is pulled toward it. `null` keeps the current (FK) bend direction.
   */
  readonly polePos: Vec3 | null;
  /** Current world-space rotation of the root joint. */
  readonly rootWorldRot: Quat;
  /** Current world-space rotation of the mid joint. */
  readonly midWorldRot: Quat;
  /** World-space rotation of the root joint's parent (to express the result locally). */
  readonly rootParentWorldRot: Quat;
}

/**
 * Result of {@link solveTwoBone}: new **local** rotations for the root and mid
 * joints, plus the solved **world** rotation of the mid joint (so a caller can
 * orient the tip relative to it for a planted hand/foot). Caller-allocated and
 * overwritten in place.
 */
export interface TwoBoneSolveOutput {
  /** New local rotation for the root joint. */
  rootLocalRot: Quat;
  /** New local rotation for the mid joint (its parent is the root joint). */
  midLocalRot: Quat;
  /** New world rotation of the mid joint. */
  midWorldRot: Quat;
}

const EPS = 1e-5;

// Scratch reused across calls — the solver runs once per constrained limb per
// frame on the single render thread.
const ab = vec3.create();
const cb = vec3.create();
const at = vec3.create();
const n = vec3.create();
const poleVec = vec3.create();
const poleDir = vec3.create();
const bNew = vec3.create();
const dirOld = vec3.create();
const dirNew = vec3.create();
const midDirRotated = vec3.create();
const dirTip = vec3.create();
const targetClamped = vec3.create();
const tmpScaled = vec3.create();
const deltaRoot = quat.create();
const deltaMid = quat.create();
const rootWorldNew = quat.create();
const midWorldNew = quat.create();
const invParent = quat.create();

/**
 * Analytic two-bone IK solver (law of cosines). Places the mid joint on the
 * circle that lets the tip reach the target, bending toward the pole, then
 * returns the joint rotations that realize it. When the target is out of reach
 * the chain extends straight toward it (distance is clamped into the solvable
 * range); when it is too close the chain folds. Pure math — no ECS access.
 *
 * Assumes a direct chain (the mid joint's parent is the root joint, the tip's
 * parent is the mid joint).
 */
export const solveTwoBone = (input: TwoBoneSolveInput, out: TwoBoneSolveOutput): void => {
  const { rootPos: a, midPos: b, tipPos: c } = input;

  const lab = vec3.distance(a, b);
  const lcb = vec3.distance(b, c);

  vec3.subtract(input.targetPos, a, at);
  const distAt = vec3.length(at);

  // Degenerate (target on the root, or a collapsed bone): pass FK through.
  if (distAt < EPS || lab < EPS || lcb < EPS) {
    quat.inverse(input.rootParentWorldRot, invParent);
    quat.multiply(invParent, input.rootWorldRot, out.rootLocalRot);
    quat.inverse(input.rootWorldRot, invParent);
    quat.multiply(invParent, input.midWorldRot, out.midLocalRot);
    quat.copy(input.midWorldRot, out.midWorldRot);
    return;
  }

  // Clamp the reach into the triangle-solvable range so the elbow height stays
  // real: [ |lab - lcb| , lab + lcb ], shrunk by EPS to avoid a locked joint.
  const minReach = Math.abs(lab - lcb) + EPS;
  const maxReach = lab + lcb - EPS;
  const lat = Math.min(Math.max(distAt, minReach), maxReach);

  // Clamped target axis and position.
  vec3.scale(at, 1 / distAt, n);
  vec3.scale(n, lat, tmpScaled);
  vec3.add(a, tmpScaled, targetClamped);

  // Bend direction: the component of the pole (or current knee) perpendicular
  // to the root→target axis.
  if (input.polePos !== null) {
    vec3.subtract(input.polePos, a, poleVec);
  } else {
    vec3.subtract(b, a, poleVec);
  }
  vec3.scale(n, vec3.dot(poleVec, n), tmpScaled);
  vec3.subtract(poleVec, tmpScaled, poleDir);
  if (vec3.length(poleDir) < EPS) {
    // Colinear with the target axis and no usable pole — keep the current knee
    // direction projected; if that too is colinear, fabricate a perpendicular.
    vec3.subtract(b, a, poleVec);
    vec3.scale(n, vec3.dot(poleVec, n), tmpScaled);
    vec3.subtract(poleVec, tmpScaled, poleDir);
    if (vec3.length(poleDir) < EPS) {
      vec3.set(Math.abs(n[0]!) < 0.9 ? 1 : 0, Math.abs(n[0]!) < 0.9 ? 0 : 1, 0, poleDir);
      vec3.scale(n, vec3.dot(poleDir, n), tmpScaled);
      vec3.subtract(poleDir, tmpScaled, poleDir);
    }
  }
  vec3.normalize(poleDir, poleDir);

  // Law of cosines: distance along the axis to the mid joint, and its height.
  const d1 = (lat * lat + lab * lab - lcb * lcb) / (2 * lat);
  const h = Math.sqrt(Math.max(0, lab * lab - d1 * d1));
  vec3.scale(n, d1, bNew);
  vec3.add(a, bNew, bNew);
  vec3.scale(poleDir, h, tmpScaled);
  vec3.add(bNew, tmpScaled, bNew);

  // Root delta: rotate (b - a) onto (bNew - a).
  vec3.subtract(b, a, ab);
  vec3.normalize(ab, dirOld);
  vec3.subtract(bNew, a, cb);
  vec3.normalize(cb, dirNew);
  quat.rotationTo(dirOld, dirNew, deltaRoot);
  quat.multiply(deltaRoot, input.rootWorldRot, rootWorldNew);

  // Mid delta: after the root rotates, the mid bone vector (c - b) rotates with
  // it; bring that onto (clampedTarget - bNew).
  vec3.subtract(c, b, cb);
  vec3.transformQuat(cb, deltaRoot, midDirRotated);
  vec3.normalize(midDirRotated, midDirRotated);
  vec3.subtract(targetClamped, bNew, dirTip);
  vec3.normalize(dirTip, dirTip);
  quat.rotationTo(midDirRotated, dirTip, deltaMid);
  // midWorldNew = deltaMid · deltaRoot · midWorldRot
  quat.multiply(deltaRoot, input.midWorldRot, midWorldNew);
  quat.multiply(deltaMid, midWorldNew, midWorldNew);

  // Express both as local rotations (mid's parent is the root).
  quat.inverse(input.rootParentWorldRot, invParent);
  quat.multiply(invParent, rootWorldNew, out.rootLocalRot);
  quat.inverse(rootWorldNew, invParent);
  quat.multiply(invParent, midWorldNew, out.midLocalRot);
  quat.copy(midWorldNew, out.midWorldRot);
};
