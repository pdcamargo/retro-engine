import type { Quat, Vec3 } from '@retro-engine/math';
import { quat, vec3 } from '@retro-engine/math';

/** World-space inputs to {@link solveAim}, sampled from the posed skeleton. */
export interface AimSolveInput {
  /** World position of the bone being aimed. */
  readonly bonePos: Vec3;
  /** Current world-space rotation of the bone. */
  readonly boneWorldRot: Quat;
  /** World-space rotation of the bone's parent (to express the result locally). */
  readonly boneParentWorldRot: Quat;
  /** World position to aim at. */
  readonly targetPos: Vec3;
  /** Local axis of the bone that should point at the target (e.g. +Z). */
  readonly aimAxis: Vec3;
  /** Local axis of the bone kept toward {@link worldUp} to control the twist. */
  readonly upAxis: Vec3;
  /** World-space reference up the twist aligns {@link upAxis} with. */
  readonly worldUp: Vec3;
}

const EPS = 1e-5;

const desiredDir = vec3.create();
const curAim = vec3.create();
const curUp = vec3.create();
const upRef = vec3.create();
const curUpProj = vec3.create();
const tmp = vec3.create();
const swing = quat.create();
const twist = quat.create();
const worldRot = quat.create();
const invParent = quat.create();

/**
 * Aim / look-at constraint. Builds the bone rotation whose local `aimAxis`
 * points at the target, then rolls it about that axis so the local `upAxis`
 * lines up with `worldUp` (the twist reference). Returns the new **local**
 * rotation. Pure math — no ECS access.
 */
export const solveAim = (input: AimSolveInput, out: Quat): void => {
  vec3.subtract(input.targetPos, input.bonePos, desiredDir);
  if (vec3.length(desiredDir) < EPS) {
    quat.inverse(input.boneParentWorldRot, invParent);
    quat.multiply(invParent, input.boneWorldRot, out);
    return;
  }
  vec3.normalize(desiredDir, desiredDir);

  // Primary swing: current world aim axis → desired direction.
  vec3.transformQuat(input.aimAxis, input.boneWorldRot, curAim);
  vec3.normalize(curAim, curAim);
  quat.rotationTo(curAim, desiredDir, swing);
  quat.multiply(swing, input.boneWorldRot, worldRot);

  // Twist: align the up axis (projected off the aim direction) with worldUp.
  vec3.scale(desiredDir, vec3.dot(input.worldUp, desiredDir), tmp);
  vec3.subtract(input.worldUp, tmp, upRef);
  if (vec3.length(upRef) > EPS) {
    vec3.normalize(upRef, upRef);
    vec3.transformQuat(input.upAxis, worldRot, curUp);
    vec3.scale(desiredDir, vec3.dot(curUp, desiredDir), tmp);
    vec3.subtract(curUp, tmp, curUpProj);
    if (vec3.length(curUpProj) > EPS) {
      vec3.normalize(curUpProj, curUpProj);
      quat.rotationTo(curUpProj, upRef, twist);
      quat.multiply(twist, worldRot, worldRot);
    }
  }

  quat.inverse(input.boneParentWorldRot, invParent);
  quat.multiply(invParent, worldRot, out);
};
