import type { Quat, Vec3 } from '@retro-engine/math';
import { quat, vec3 } from '@retro-engine/math';

/**
 * World-space inputs to {@link solveCcd}. `jointWorldPos`/`jointWorldRot` run
 * root → tip and describe a direct parent chain (each joint is the ECS parent
 * of the next); the **last** joint is the end effector driven to the target.
 */
export interface CcdSolveInput {
  /** Joint world positions, root → tip. The last entry is the end effector. */
  readonly jointWorldPos: readonly Vec3[];
  /** Joint world rotations, parallel to {@link jointWorldPos}. */
  readonly jointWorldRot: readonly Quat[];
  /** World rotation of the chain root's parent (to express joint 0 locally). */
  readonly rootParentWorldRot: Quat;
  /** World position the end effector should reach. */
  readonly targetPos: Vec3;
  /** Maximum solver sweeps. */
  readonly iterations: number;
  /** Stop once the end effector is within this distance of the target. */
  readonly tolerance: number;
}

const EPS = 1e-5;

// Module-level growable scratch — the solver runs once per chain per frame on
// the single render thread, so reusing these keeps it allocation-free.
const posPool: Vec3[] = [];
const deltaPool: Quat[] = [];
const worldNewPool: Quat[] = [];
const toEnd = vec3.create();
const toTarget = vec3.create();
const rot = quat.create();
const offset = vec3.create();
const rotated = vec3.create();
const invParent = quat.create();
const ensurePools = (n: number): void => {
  while (posPool.length < n) {
    posPool.push(vec3.create());
    deltaPool.push(quat.create());
    worldNewPool.push(quat.create());
  }
};

/**
 * Cyclic Coordinate Descent (CCD) for an N-bone chain. Each sweep rotates every
 * joint (tip-adjacent first, back to the root) so the end effector swings toward
 * the target, re-running forward kinematics on the affected sub-chain after each
 * rotation, until the effector is within `tolerance` or `iterations` run out.
 * Works directly in joint-rotation space (the natural fit for a bone hierarchy)
 * and returns new **local** rotations for joints `0 … n-2` — the end effector's
 * own rotation does not affect reach and is left at its FK value. Pure math.
 *
 * `out` must hold `n - 1` quaternions (caller-allocated, overwritten in place).
 */
export const solveCcd = (input: CcdSolveInput, out: Quat[]): void => {
  const n = input.jointWorldPos.length;
  if (n < 2) return;
  ensurePools(n);

  // Mutable working copies of world positions and per-joint accumulated deltas.
  const pos = posPool;
  const delta = deltaPool;
  for (let i = 0; i < n; i++) {
    vec3.copy(input.jointWorldPos[i]!, pos[i]!);
    quat.identity(delta[i]!);
  }

  const end = n - 1;
  for (let iter = 0; iter < input.iterations; iter++) {
    if (vec3.distance(pos[end]!, input.targetPos) <= input.tolerance) break;
    for (let i = end - 1; i >= 0; i--) {
      const pivot = pos[i]!;
      vec3.subtract(pos[end]!, pivot, toEnd);
      vec3.subtract(input.targetPos, pivot, toTarget);
      if (vec3.length(toEnd) < EPS || vec3.length(toTarget) < EPS) continue;
      vec3.normalize(toEnd, toEnd);
      vec3.normalize(toTarget, toTarget);
      quat.rotationTo(toEnd, toTarget, rot);
      // Rotating joint i turns it and every descendant rigidly about the pivot:
      // update their positions and fold the rotation into each one's accumulated
      // world-orientation delta.
      for (let k = i + 1; k < n; k++) {
        vec3.subtract(pos[k]!, pivot, offset);
        vec3.transformQuat(offset, rot, rotated);
        vec3.add(pivot, rotated, pos[k]!);
      }
      for (let k = i; k < n; k++) {
        quat.multiply(rot, delta[k]!, delta[k]!);
      }
    }
  }

  // Convert accumulated world deltas to local rotations. Joint i's parent is
  // joint i-1 (or the chain root's parent for i = 0); use the already-updated
  // parent world rotation so the chain composes correctly.
  const worldNew = worldNewPool;
  for (let i = 0; i < n; i++) {
    quat.multiply(delta[i]!, input.jointWorldRot[i]!, worldNew[i]!);
  }
  for (let i = 0; i < end; i++) {
    const parentWorld = i === 0 ? input.rootParentWorldRot : worldNew[i - 1]!;
    quat.inverse(parentWorld, invParent);
    quat.multiply(invParent, worldNew[i]!, out[i]!);
  }
};
