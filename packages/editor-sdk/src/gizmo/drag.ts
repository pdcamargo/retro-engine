import { type Quat, type Vec3, quat, vec3 } from '@retro-engine/math';

import type { GizmoTarget } from './types';

/** Immutable copy of a target's TRS, captured at drag start. */
export interface TargetSnapshot {
  readonly t: Vec3;
  readonly r: Quat;
  readonly s: Vec3;
}

/** Snapshot every target's transform so a drag can be applied from a fixed base (and reverted). */
export const snapshotTargets = (targets: readonly GizmoTarget[]): TargetSnapshot[] =>
  targets.map((tgt) => ({ t: vec3.clone(tgt.translation), r: quat.clone(tgt.rotation), s: vec3.clone(tgt.scale) }));

/** Restore every target to its snapshot — used by Escape-to-cancel. */
export const restoreTargets = (targets: readonly GizmoTarget[], snaps: readonly TargetSnapshot[]): void => {
  for (let i = 0; i < targets.length; i++) {
    const tgt = targets[i]!;
    const s = snaps[i]!;
    writeVec3(tgt.translation, s.t[0]!, s.t[1]!, s.t[2]!);
    tgt.rotation[0] = s.r[0]!;
    tgt.rotation[1] = s.r[1]!;
    tgt.rotation[2] = s.r[2]!;
    tgt.rotation[3] = s.r[3]!;
    writeVec3(tgt.scale, s.s[0]!, s.s[1]!, s.s[2]!);
  }
};

/** Translate every target by `(dx, dy, dz)` from its snapshot. */
export const applyTranslation = (
  targets: readonly GizmoTarget[],
  snaps: readonly TargetSnapshot[],
  dx: number,
  dy: number,
  dz: number,
): void => {
  for (let i = 0; i < targets.length; i++) {
    const s = snaps[i]!.t;
    writeVec3(targets[i]!.translation, s[0]! + dx, s[1]! + dy, s[2]! + dz);
  }
};

/**
 * Rotate every target by `angle` radians about `axis` around the shared
 * `pivot0`: each target's orientation is pre-multiplied and its position orbits
 * the pivot. Recomputed from the snapshot each frame, so it never accumulates.
 */
export const applyRotation = (
  targets: readonly GizmoTarget[],
  snaps: readonly TargetSnapshot[],
  pivot0: Vec3,
  axis: Vec3,
  angle: number,
): void => {
  const dq = quat.fromAxisAngle(axis, angle);
  const offset = vec3.create(0, 0, 0);
  for (let i = 0; i < targets.length; i++) {
    const tgt = targets[i]!;
    const s = snaps[i]!;
    const nr = quat.mul(dq, s.r);
    quat.normalize(nr, nr);
    tgt.rotation[0] = nr[0]!;
    tgt.rotation[1] = nr[1]!;
    tgt.rotation[2] = nr[2]!;
    tgt.rotation[3] = nr[3]!;
    offset[0] = s.t[0]! - pivot0[0]!;
    offset[1] = s.t[1]! - pivot0[1]!;
    offset[2] = s.t[2]! - pivot0[2]!;
    const rotated = vec3.transformQuat(offset, dq);
    writeVec3(tgt.translation, pivot0[0]! + rotated[0]!, pivot0[1]! + rotated[1]!, pivot0[2]! + rotated[2]!);
  }
};

/**
 * Scale every target by `(sx, sy, sz)` about the shared `pivot0`: scale
 * components multiply and positions move along each axis relative to the pivot.
 * Recomputed from the snapshot each frame.
 */
export const applyScale = (
  targets: readonly GizmoTarget[],
  snaps: readonly TargetSnapshot[],
  pivot0: Vec3,
  sx: number,
  sy: number,
  sz: number,
): void => {
  for (let i = 0; i < targets.length; i++) {
    const tgt = targets[i]!;
    const s = snaps[i]!;
    writeVec3(tgt.scale, s.s[0]! * sx, s.s[1]! * sy, s.s[2]! * sz);
    writeVec3(
      tgt.translation,
      pivot0[0]! + (s.t[0]! - pivot0[0]!) * sx,
      pivot0[1]! + (s.t[1]! - pivot0[1]!) * sy,
      pivot0[2]! + (s.t[2]! - pivot0[2]!) * sz,
    );
  }
};

/** Centroid of the targets' translations — the shared pivot for multi-select edits. */
export const computePivot = (targets: readonly GizmoTarget[], dst: Vec3): Vec3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const tgt of targets) {
    x += tgt.translation[0]!;
    y += tgt.translation[1]!;
    z += tgt.translation[2]!;
  }
  const n = targets.length || 1;
  dst[0] = x / n;
  dst[1] = y / n;
  dst[2] = z / n;
  return dst;
};

const writeVec3 = (out: Vec3, x: number, y: number, z: number): void => {
  out[0] = x;
  out[1] = y;
  out[2] = z;
};
