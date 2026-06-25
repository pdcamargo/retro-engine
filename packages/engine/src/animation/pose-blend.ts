import type { ComponentType, World } from '@retro-engine/ecs';

import { Transform } from '../transform';
import type { AnimationClip, AnimationTrack } from './animation-clip';
import type { Pose } from './pose';
import { sampleInto } from './sampler';

/**
 * Which local-`Transform` field a track drives, or `undefined` if the track is
 * not a whole-field bone transform track (a non-`Transform` component, or a
 * sub-component path such as `translation/0`). Only whole-field translation,
 * rotation, and scale tracks route through the pose; everything else is written
 * directly by the sampling system.
 */
export const boneTrackField = (track: AnimationTrack): 't' | 'r' | 's' | undefined => {
  if (track.target.component !== 'Transform') return undefined;
  const path = track.target.path;
  if (path.length !== 1) return undefined;
  const seg = path[0]!;
  if (seg.kind !== 'field') return undefined;
  if (seg.name === 'translation') return 't';
  if (seg.name === 'rotation') return 'r';
  if (seg.name === 'scale') return 's';
  return undefined;
};

/** Accumulate a weighted translation `(x, y, z)` into `pose` at `slot`. */
export const accumulateTranslation = (
  pose: Pose,
  slot: number,
  x: number,
  y: number,
  z: number,
  weight: number,
): void => {
  const i = slot * 3;
  pose.t[i] = pose.t[i]! + weight * x;
  pose.t[i + 1] = pose.t[i + 1]! + weight * y;
  pose.t[i + 2] = pose.t[i + 2]! + weight * z;
  pose.wt[slot] = pose.wt[slot]! + weight;
};

/** Accumulate a weighted scale `(x, y, z)` into `pose` at `slot`. */
export const accumulateScale = (
  pose: Pose,
  slot: number,
  x: number,
  y: number,
  z: number,
  weight: number,
): void => {
  const i = slot * 3;
  pose.s[i] = pose.s[i]! + weight * x;
  pose.s[i + 1] = pose.s[i + 1]! + weight * y;
  pose.s[i + 2] = pose.s[i + 2]! + weight * z;
  pose.ws[slot] = pose.ws[slot]! + weight;
};

/**
 * Accumulate a weighted rotation quaternion `(x, y, z, w)` into `pose` at `slot`
 * using sign-aligned nlerp: the first contributor fixes the hemisphere; each
 * later quaternion is negated when its dot with the running accumulator is
 * negative, so antipodal-but-equal rotations blend the short way instead of
 * cancelling. {@link finalizePose} renormalizes the accumulated sum into a unit
 * quaternion.
 */
export const accumulateRotation = (
  pose: Pose,
  slot: number,
  x: number,
  y: number,
  z: number,
  w: number,
  weight: number,
): void => {
  const i = slot * 4;
  if (pose.wr[slot] === 0) {
    pose.r[i] = weight * x;
    pose.r[i + 1] = weight * y;
    pose.r[i + 2] = weight * z;
    pose.r[i + 3] = weight * w;
  } else {
    const dot = pose.r[i]! * x + pose.r[i + 1]! * y + pose.r[i + 2]! * z + pose.r[i + 3]! * w;
    const s = dot < 0 ? -weight : weight;
    pose.r[i] = pose.r[i]! + s * x;
    pose.r[i + 1] = pose.r[i + 1]! + s * y;
    pose.r[i + 2] = pose.r[i + 2]! + s * z;
    pose.r[i + 3] = pose.r[i + 3]! + s * w;
  }
  pose.wr[slot] = pose.wr[slot]! + weight;
};

/**
 * Finish a blend: divide each accumulated translation/scale by its total weight
 * (a weighted average) and renormalize each accumulated rotation to a unit
 * quaternion. Slots with zero weight for a field are left as-is — they carry no
 * animation and are skipped on commit.
 */
export const finalizePose = (pose: Pose): void => {
  const n = pose.jointCount;
  for (let slot = 0; slot < n; slot++) {
    const wt = pose.wt[slot]!;
    if (wt > 0) {
      const i = slot * 3;
      pose.t[i] = pose.t[i]! / wt;
      pose.t[i + 1] = pose.t[i + 1]! / wt;
      pose.t[i + 2] = pose.t[i + 2]! / wt;
    }
    const ws = pose.ws[slot]!;
    if (ws > 0) {
      const i = slot * 3;
      pose.s[i] = pose.s[i]! / ws;
      pose.s[i + 1] = pose.s[i + 1]! / ws;
      pose.s[i + 2] = pose.s[i + 2]! / ws;
    }
    if (pose.wr[slot]! > 0) {
      const i = slot * 4;
      const x = pose.r[i]!;
      const y = pose.r[i + 1]!;
      const z = pose.r[i + 2]!;
      const w = pose.r[i + 3]!;
      const len = Math.hypot(x, y, z, w);
      if (len > 0) {
        pose.r[i] = x / len;
        pose.r[i + 1] = y / len;
        pose.r[i + 2] = z / len;
        pose.r[i + 3] = w / len;
      } else {
        pose.r[i] = 0;
        pose.r[i + 1] = 0;
        pose.r[i + 2] = 0;
        pose.r[i + 3] = 1;
      }
    }
  }
};

/**
 * Sample one clip's whole-field bone `Transform` tracks at `time` and accumulate
 * them into `pose` with `weight`. `slotByTargetId` maps a track's `targetId` to
 * the pose slot for the bound bone; tracks whose target is unbound or not a bone
 * transform are ignored here (non-bone tracks are written directly elsewhere).
 * `scratch` must be at least four floats long and is reused across tracks.
 */
export const samplePoseFromClip = (
  clip: AnimationClip,
  time: number,
  weight: number,
  slotByTargetId: ReadonlyMap<string, number>,
  pose: Pose,
  scratch: Float32Array,
): void => {
  for (const track of clip.tracks) {
    const field = boneTrackField(track);
    if (field === undefined) continue;
    const slot = slotByTargetId.get(track.target.targetId);
    if (slot === undefined) continue;
    const isRotation = field === 'r';
    sampleInto(track.sampler, time, isRotation, scratch);
    if (field === 't') {
      accumulateTranslation(pose, slot, scratch[0]!, scratch[1]!, scratch[2]!, weight);
    } else if (field === 'r') {
      accumulateRotation(pose, slot, scratch[0]!, scratch[1]!, scratch[2]!, scratch[3]!, weight);
    } else {
      accumulateScale(pose, slot, scratch[0]!, scratch[1]!, scratch[2]!, weight);
    }
  }
};

/**
 * Write a finalized pose into its bound bones' `Transform` components, one write
 * per bone, and mark each changed so the `postUpdate` propagation (and the
 * skinning palette downstream) observe the new pose. Only fields with a non-zero
 * blend weight are written, leaving un-animated translation/rotation/scale at
 * their authored values.
 */
export const commitPoseToTransforms = (pose: Pose, world: World): void => {
  const n = pose.jointCount;
  for (let slot = 0; slot < n; slot++) {
    const wt = pose.wt[slot]!;
    const wr = pose.wr[slot]!;
    const ws = pose.ws[slot]!;
    if (wt === 0 && wr === 0 && ws === 0) continue;
    const entity = pose.targets[slot]!;
    const transform = world.getComponent(entity, Transform);
    if (transform === undefined) continue;
    if (wt > 0) {
      const i = slot * 3;
      transform.translation[0] = pose.t[i]!;
      transform.translation[1] = pose.t[i + 1]!;
      transform.translation[2] = pose.t[i + 2]!;
    }
    if (wr > 0) {
      const i = slot * 4;
      transform.rotation[0] = pose.r[i]!;
      transform.rotation[1] = pose.r[i + 1]!;
      transform.rotation[2] = pose.r[i + 2]!;
      transform.rotation[3] = pose.r[i + 3]!;
    }
    if (ws > 0) {
      const i = slot * 3;
      transform.scale[0] = pose.s[i]!;
      transform.scale[1] = pose.s[i + 1]!;
      transform.scale[2] = pose.s[i + 2]!;
    }
    world.markChanged(entity, Transform as ComponentType);
  }
};
