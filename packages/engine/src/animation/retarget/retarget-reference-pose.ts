import type { Mat4, Quat, Vec3 } from '@retro-engine/math';
import { mat4, quat, vec3 } from '@retro-engine/math';

import type { HumanoidSlot } from './humanoid';

/**
 * The canonical world direction each humanoid bone points in the **shared
 * reference pose** — a clean T-pose: spine and head up, arms out along the
 * sides, legs straight down, feet forward. Both rigs being retargeted are posed
 * into this same pose, so motion transfers as a deviation from a *common* zero
 * rather than from each rig's own (possibly different) bind. Axes: +Y up, +X the
 * character's left, +Z forward.
 */
const CANON_DIR: Readonly<Record<HumanoidSlot, readonly [number, number, number]>> = {
  Hips: [0, 1, 0],
  Spine: [0, 1, 0],
  Chest: [0, 1, 0],
  UpperChest: [0, 1, 0],
  Neck: [0, 1, 0],
  Head: [0, 1, 0],
  LeftShoulder: [1, 0, 0],
  LeftUpperArm: [1, 0, 0],
  LeftLowerArm: [1, 0, 0],
  LeftHand: [1, 0, 0],
  RightShoulder: [-1, 0, 0],
  RightUpperArm: [-1, 0, 0],
  RightLowerArm: [-1, 0, 0],
  RightHand: [-1, 0, 0],
  LeftUpperLeg: [0, -1, 0],
  LeftLowerLeg: [0, -1, 0],
  LeftFoot: [0, 0, 1],
  LeftToes: [0, 0, 1],
  RightUpperLeg: [0, -1, 0],
  RightLowerLeg: [0, -1, 0],
  RightFoot: [0, 0, 1],
  RightToes: [0, 0, 1],
};

// The secondary axis that fixes each bone's twist (roll) about its primary
// direction. A bone direction alone constrains only two of three rotational
// degrees of freedom, so without a twist reference the wrist/forearm roll is
// ambiguous and rigs disagree on it. `up` (+Y) for the feet/toes (whose forward
// direction is parallel to the world forward); `forward` (+Z) for every other
// bone (their directions lie in the body's coronal plane, so forward is never
// parallel to them). Both rigs use the same per-slot choice, evaluated against
// each rig's own measured up/forward, so the twist is resolved consistently.
type SecondaryAxis = 'up' | 'forward';
const FEET: ReadonlySet<HumanoidSlot> = new Set<HumanoidSlot>([
  'LeftFoot',
  'LeftToes',
  'RightFoot',
  'RightToes',
]);
const secondaryAxisFor = (slot: HumanoidSlot): SecondaryAxis => (FEET.has(slot) ? 'up' : 'forward');

// Downstream bones (nearest first) whose bind position gives a bone its
// reference direction. A bone points toward the first of these the rig actually
// maps; a leaf with none falls back to continuing its parent's direction.
const CANON_CHILD: Readonly<Record<HumanoidSlot, readonly HumanoidSlot[]>> = {
  Hips: ['Spine', 'Chest', 'UpperChest', 'Neck', 'Head'],
  Spine: ['Chest', 'UpperChest', 'Neck', 'Head'],
  Chest: ['UpperChest', 'Neck', 'Head'],
  UpperChest: ['Neck', 'Head'],
  Neck: ['Head'],
  Head: [],
  LeftShoulder: ['LeftUpperArm', 'LeftLowerArm', 'LeftHand'],
  LeftUpperArm: ['LeftLowerArm', 'LeftHand'],
  LeftLowerArm: ['LeftHand'],
  LeftHand: [],
  RightShoulder: ['RightUpperArm', 'RightLowerArm', 'RightHand'],
  RightUpperArm: ['RightLowerArm', 'RightHand'],
  RightLowerArm: ['RightHand'],
  RightHand: [],
  LeftUpperLeg: ['LeftLowerLeg', 'LeftFoot', 'LeftToes'],
  LeftLowerLeg: ['LeftFoot', 'LeftToes'],
  LeftFoot: ['LeftToes'],
  LeftToes: [],
  RightUpperLeg: ['RightLowerLeg', 'RightFoot', 'RightToes'],
  RightLowerLeg: ['RightFoot', 'RightToes'],
  RightFoot: ['RightToes'],
  RightToes: [],
};

// Scratch — reference-pose derivation is single-threaded.
const ax1 = vec3.create();
const ax2 = vec3.create();
const ax3 = vec3.create();
const dirV = vec3.create();
const upV = vec3.create();
const sideV = vec3.create();
const fwdV = vec3.create();

/**
 * Build an orthonormal rotation (column-major into `out`) whose first column is
 * `primary` and whose second/third columns span the plane fixed by `secondary`.
 * The frame is right-handed: column1 × column2 = column3. Returns `false`
 * (leaving `out` identity) when the inputs are degenerate — `primary` near zero,
 * or `secondary` parallel to it.
 */
export const frameFromAxes = (primary: Vec3, secondary: Vec3, out: Mat4): boolean => {
  mat4.identity(out);
  vec3.copy(primary, ax1);
  if (vec3.length(ax1) < 1e-5) return false;
  vec3.normalize(ax1, ax1);
  vec3.cross(ax1, secondary, ax3);
  if (vec3.length(ax3) < 1e-5) return false;
  vec3.normalize(ax3, ax3);
  vec3.normalize(vec3.cross(ax3, ax1, ax2), ax2);
  out[0] = ax1[0]!; out[1] = ax1[1]!; out[2] = ax1[2]!;
  out[4] = ax2[0]!; out[5] = ax2[1]!; out[6] = ax2[2]!;
  out[8] = ax3[0]!; out[9] = ax3[1]!; out[10] = ax3[2]!;
  return true;
};

// The canonical reference frame per slot, precomputed once. Constant across all
// rigs (it is the shared T-pose), so it cancels out of the final transfer
// factors — its role is to make the stored reference rotations a recognizable
// pose (so an authored override is meaningful) rather than to steer the math.
const CANON_FRAME: Map<HumanoidSlot, Quat> = (() => {
  const m = mat4.create();
  const out = new Map<HumanoidSlot, Quat>();
  for (const slot of Object.keys(CANON_DIR) as HumanoidSlot[]) {
    const dir = CANON_DIR[slot];
    const sec = secondaryAxisFor(slot) === 'up' ? [0, 1, 0] : [0, 0, 1];
    frameFromAxes(
      vec3.create(dir[0], dir[1], dir[2]),
      vec3.create(sec[0]!, sec[1]!, sec[2]!),
      m,
    );
    out.set(slot, quat.fromMat(m, quat.create()));
  }
  return out;
})();

/** The bind data {@link computeReferencePose} needs for one mapped bone. */
export interface ReferencePoseBone {
  /** The canonical slot this bone fills. */
  readonly slot: HumanoidSlot;
  /** Bind **world** translation (skeleton-root frame). */
  readonly restWorldT: Vec3;
  /** Bind **world** rotation (skeleton-root frame). */
  readonly restWorldR: Quat;
  /** Bind **world** rotation of the bone's immediate parent. */
  readonly parentRestWorldR: Quat;
  /** The nearest mapped ancestor's slot, or `undefined` at the top of the chain. */
  readonly parentSlot: HumanoidSlot | undefined;
}

/** The reference-pose rotations {@link computeReferencePose} derives per bone. */
export interface ReferencePoseEntry {
  /** This bone's **world** rotation in the shared reference pose. */
  readonly refWorldR: Quat;
  /** Its immediate parent's reference-pose **world** rotation. */
  readonly parentRefWorldR: Quat;
}

/**
 * Author a bone's reference-pose **world** rotation by hand, overriding the
 * auto-derived value for that slot — the Unreal "retarget pose" escape hatch for
 * a rig whose bind pose the direction heuristic reads wrong (e.g. badly
 * degenerate limbs). Slots left out keep their derived rotation.
 */
export type AuthoredReferencePose = Partial<Record<HumanoidSlot, Quat>>;

/**
 * Derive each mapped bone's **world** rotation in the shared reference pose from
 * its bind bone direction (`bone → child` world vector — position-based, so it
 * is immune to the per-bone local-axis conventions and container rotations two
 * exports may disagree on) plus a per-slot twist axis. A bone's reference
 * rotation re-aims it from however it rests at bind onto the canonical T-pose
 * direction for its slot; the retarget then transfers motion as a deviation from
 * this *shared* pose, so a source at rest lands the target at the source's rest
 * shape rather than at the target's own (possibly different) bind.
 *
 * `authored` overrides the derived rotation for any slot it names.
 */
export const computeReferencePose = (
  bones: readonly ReferencePoseBone[],
  authored: AuthoredReferencePose = {},
): Map<HumanoidSlot, ReferencePoseEntry> => {
  const bySlot = new Map<HumanoidSlot, ReferencePoseBone>(bones.map((b) => [b.slot, b]));

  // The rig's measured body frame, the source of each bone's twist reference.
  const hips = bySlot.get('Hips');
  const head = bySlot.get('Head');
  const legL = bySlot.get('LeftUpperLeg');
  const legR = bySlot.get('RightUpperLeg');
  vec3.set(0, 1, 0, upV);
  if (hips !== undefined && head !== undefined) {
    vec3.subtract(head.restWorldT, hips.restWorldT, upV);
    if (vec3.length(upV) < 1e-5) vec3.set(0, 1, 0, upV);
  }
  vec3.normalize(upV, upV);
  vec3.set(1, 0, 0, sideV);
  if (legL !== undefined && legR !== undefined) {
    vec3.subtract(legL.restWorldT, legR.restWorldT, sideV);
    if (vec3.length(sideV) < 1e-5) vec3.set(1, 0, 0, sideV);
  }
  vec3.normalize(sideV, sideV);
  vec3.cross(upV, sideV, fwdV);
  if (vec3.length(fwdV) < 1e-5) vec3.set(0, 0, 1, fwdV);
  vec3.normalize(fwdV, fwdV);

  const bindFrame = mat4.create();
  const qBind = quat.create();
  const refWorld = new Map<HumanoidSlot, Quat>();

  for (const bone of bones) {
    // Bind bone direction: toward the nearest mapped descendant, else continuing
    // the parent → this segment (leaves), else the canonical direction.
    let haveDir = false;
    for (const childSlot of CANON_CHILD[bone.slot]) {
      const child = bySlot.get(childSlot);
      if (child !== undefined) {
        vec3.subtract(child.restWorldT, bone.restWorldT, dirV);
        haveDir = vec3.length(dirV) >= 1e-5;
        if (haveDir) break;
      }
    }
    if (!haveDir && bone.parentSlot !== undefined) {
      const parent = bySlot.get(bone.parentSlot);
      if (parent !== undefined) {
        vec3.subtract(bone.restWorldT, parent.restWorldT, dirV);
        haveDir = vec3.length(dirV) >= 1e-5;
      }
    }
    if (!haveDir) {
      const cd = CANON_DIR[bone.slot];
      vec3.set(cd[0], cd[1], cd[2], dirV);
    }

    const secondary = secondaryAxisFor(bone.slot) === 'up' ? upV : fwdV;
    const ref = quat.create();
    if (frameFromAxes(dirV, secondary, bindFrame)) {
      // refWorld = canonFrame · bindFrame⁻¹ · restWorld
      quat.fromMat(bindFrame, qBind);
      quat.inverse(qBind, qBind);
      quat.multiply(CANON_FRAME.get(bone.slot)!, qBind, ref);
      quat.multiply(ref, bone.restWorldR, ref);
      quat.normalize(ref, ref);
    } else {
      // Degenerate landmarks: leave the bone at its bind (transfers as before).
      quat.copy(bone.restWorldR, ref);
    }
    refWorld.set(bone.slot, ref);
  }

  for (const slot of Object.keys(authored) as HumanoidSlot[]) {
    const q = authored[slot];
    if (q !== undefined && refWorld.has(slot)) refWorld.set(slot, quat.clone(q));
  }

  const result = new Map<HumanoidSlot, ReferencePoseEntry>();
  for (const bone of bones) {
    const parentRef =
      bone.parentSlot !== undefined && refWorld.has(bone.parentSlot)
        ? quat.clone(refWorld.get(bone.parentSlot)!)
        : quat.clone(bone.parentRestWorldR);
    result.set(bone.slot, { refWorldR: refWorld.get(bone.slot)!, parentRefWorldR: parentRef });
  }
  return result;
};
