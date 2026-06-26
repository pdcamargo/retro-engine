import { quat, vec3 } from '@retro-engine/math';

import type { AnimationTrack } from '../animation-clip';
import { AnimationClip } from '../animation-clip';
import { boneTrackField } from '../pose-blend';
import type { RetargetRig, RetargetSlot } from './retarget-rig';
import type { RootTranslationMode } from './retarget-transfer';
import {
  applyRetargetFactors,
  proportionRatio,
  retargetRotationFactors,
  scaleRootTranslation,
} from './retarget-transfer';

/** Options for {@link retargetClip}. */
export interface RetargetClipOptions {
  /**
   * How the hip/root bone's translation is handled. Defaults to
   * `animationScaled` (root motion travels in proportion to the target's size);
   * `targetBindPose` drops root translation so the target holds its own stance.
   */
  readonly rootTranslationMode?: RootTranslationMode;
}

// Re-bake a rotation track onto the target bone. The transfer factors (A, B) are
// constant per bone, so they are built once from both rigs' shared reference-pose
// world rotations and applied to every keyframe value (and any CUBICSPLINE
// tangent — left-multiply by A and right-multiply by B preserves the spline
// structure).
const rebakeRotation = (
  track: AnimationTrack,
  src: RetargetSlot,
  tgt: RetargetSlot,
): AnimationTrack => {
  const a = quat.create();
  const b = quat.create();
  retargetRotationFactors(src.parentRefWorldR, src.refWorldR, tgt.parentRefWorldR, tgt.refWorldR, a, b);

  const input = track.sampler.values;
  const out = new Float32Array(input.length);
  const value = quat.create();
  const result = quat.create();
  for (let i = 0; i + 4 <= input.length; i += 4) {
    value[0] = input[i]!;
    value[1] = input[i + 1]!;
    value[2] = input[i + 2]!;
    value[3] = input[i + 3]!;
    applyRetargetFactors(a, value, b, result);
    out.set(result, i);
  }

  return {
    target: { targetId: tgt.boneId, component: 'Transform', path: track.target.path },
    sampler: {
      times: track.sampler.times,
      values: out,
      componentCount: track.sampler.componentCount,
      interpolation: track.sampler.interpolation,
    },
  };
};

// Re-bake the hip translation track for `animationScaled`: each keyframe value is
// the target's rest stance plus the source's motion delta, re-based into the
// target's root frame and scaled by `ratio`. CUBICSPLINE tangents are deltas, so
// they only rotate + scale (no rest offset).
const rebakeRootTranslation = (
  track: AnimationTrack,
  src: RetargetSlot,
  tgt: RetargetSlot,
  ratio: number,
): AnimationTrack => {
  // Frame alignment: source hip-parent reference orientation → target's.
  const frameRot = quat.create();
  quat.inverse(tgt.parentRefWorldR, frameRot);
  quat.multiply(frameRot, src.parentRefWorldR, frameRot);

  const cc = track.sampler.componentCount;
  const input = track.sampler.values;
  const out = new Float32Array(input.length);
  const anim = vec3.create();
  const value = vec3.create();
  const tangent = vec3.create();

  const writeValue = (at: number): void => {
    anim[0] = input[at]!;
    anim[1] = input[at + 1]!;
    anim[2] = input[at + 2]!;
    scaleRootTranslation(src.restT, anim, tgt.restT, ratio, frameRot, 'animationScaled', value);
    out[at] = value[0]!;
    out[at + 1] = value[1]!;
    out[at + 2] = value[2]!;
  };
  const writeTangent = (at: number): void => {
    tangent[0] = input[at]! * ratio;
    tangent[1] = input[at + 1]! * ratio;
    tangent[2] = input[at + 2]! * ratio;
    vec3.transformQuat(tangent, frameRot, tangent);
    out[at] = tangent[0]!;
    out[at + 1] = tangent[1]!;
    out[at + 2] = tangent[2]!;
  };

  if (track.sampler.interpolation === 'CUBICSPLINE') {
    const stride = 3 * cc;
    for (let k = 0; k + stride <= input.length; k += stride) {
      writeTangent(k); // inTangent
      writeValue(k + cc); // value
      writeTangent(k + 2 * cc); // outTangent
    }
  } else {
    for (let k = 0; k + cc <= input.length; k += cc) writeValue(k);
  }

  return {
    target: { targetId: tgt.boneId, component: 'Transform', path: track.target.path },
    sampler: {
      times: track.sampler.times,
      values: out,
      componentCount: cc,
      interpolation: track.sampler.interpolation,
    },
  };
};

/**
 * Retarget a clip authored for `sourceRig` so it plays on `targetRig`, producing
 * a **new, native** {@link AnimationClip} whose tracks address the target
 * skeleton's bones. This is the engine's equivalent of Unity's import-time
 * humanoid bake or Unreal's "Export Retargeted Animations": the output is an
 * ordinary clip, so it flows through `AnimationPlayer` / `AnimationController` /
 * blend trees / `AnimationLayers` and the IK post-pass with no special handling.
 *
 * Bone rotations transfer as a deviation from a **shared reference pose** both
 * rigs are posed into (a canonical T-pose), so motion crosses skeletons that rest
 * in different bind orientations — the usual case for a downloaded animation pack,
 * where the source rests in an A-pose and the target in a T-pose. Hip/root
 * translation is re-based into the target's frame and scaled by the rigs' height
 * ratio (or dropped, per `rootTranslationMode`); other bones' translation and
 * scale are dropped so the target keeps its own bind-pose bone lengths — residual
 * contact drift is corrected at runtime by foot/hand IK constraints on the target
 * rig. Tracks for bones neither rig maps to a humanoid slot (and non-`Transform`
 * tracks) are dropped.
 */
export const retargetClip = (
  source: AnimationClip,
  sourceRig: RetargetRig,
  targetRig: RetargetRig,
  opts: RetargetClipOptions = {},
): AnimationClip => {
  const mode = opts.rootTranslationMode ?? 'animationScaled';
  const tracks: AnimationTrack[] = [];

  const srcHip = sourceRig.slot('Hips');
  const tgtHip = targetRig.slot('Hips');
  // Height from the hip's distance from the skeleton root, not its Y alone — the
  // root-relative bind can carry hip height off the Y axis.
  const ratio =
    srcHip !== undefined && tgtHip !== undefined
      ? proportionRatio(vec3.length(srcHip.restWorldT), vec3.length(tgtHip.restWorldT))
      : 1;

  for (const track of source.tracks) {
    const field = boneTrackField(track);
    if (field === undefined) continue;
    const slot = sourceRig.slotByBoneId.get(track.target.targetId);
    if (slot === undefined) continue;
    const srcEntry = sourceRig.slot(slot)!;
    const tgtEntry = targetRig.slot(slot);
    if (tgtEntry === undefined) continue;

    if (field === 'r') {
      tracks.push(rebakeRotation(track, srcEntry, tgtEntry));
    } else if (field === 't' && slot === 'Hips' && mode === 'animationScaled') {
      tracks.push(rebakeRootTranslation(track, srcEntry, tgtEntry, ratio));
    }
    // Non-hip translation and all scale tracks are intentionally dropped.
  }

  return new AnimationClip(tracks, source.duration, source.name);
};
