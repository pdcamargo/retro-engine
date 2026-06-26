import { quat, vec3 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import type { AnimationTrack } from '../animation-clip';
import { AnimationClip } from '../animation-clip';
import type { HumanoidSlot } from './humanoid';
import { retargetClip } from './retarget-clip';
import type { RetargetSlot } from './retarget-rig';
import { RetargetRig } from './retarget-rig';

const slot = (
  s: HumanoidSlot,
  boneId: string,
  hipHeight = 0,
): RetargetSlot => ({
  slot: s,
  boneId,
  restT: vec3.create(0, hipHeight, 0),
  restR: quat.identity(),
  restS: vec3.create(1, 1, 1),
  restWorldT: vec3.create(0, hipHeight, 0),
  restWorldR: quat.identity(),
  parentRestWorldR: quat.identity(),
});

const rotTrack = (targetId: string, q: ArrayLike<number>): AnimationTrack => ({
  target: { targetId, component: 'Transform', path: [{ kind: 'field', name: 'rotation' }] as never },
  sampler: {
    times: new Float32Array([0, 1]),
    values: new Float32Array([q[0]!, q[1]!, q[2]!, q[3]!, q[0]!, q[1]!, q[2]!, q[3]!]),
    componentCount: 4,
    interpolation: 'LINEAR',
  },
});

describe('retargetClip', () => {
  // Source: Hips at height 1, an elbow bone 'src_elbow'. Target: same slots,
  // different bone ids, Hips at height 2 (twice as tall). Identity rests, so
  // rotations copy through and the height ratio is 2.
  const sourceRig = new RetargetRig([slot('Hips', 'src_hips', 1), slot('LeftLowerArm', 'src_elbow')]);
  const targetRig = new RetargetRig([slot('Hips', 'tgt_hips', 2), slot('LeftLowerArm', 'tgt_elbow')]);

  it('re-addresses bone rotation tracks to the target rig and copies same-rest rotations', () => {
    const q = quat.fromEuler(0.4, -0.1, 0.2, 'xyz');
    const clip = new AnimationClip([rotTrack('src_elbow', q)], 1);
    const out = retargetClip(clip, sourceRig, targetRig);

    expect(out.tracks).toHaveLength(1);
    const track = out.tracks[0]!;
    expect(track.target.targetId).toBe('tgt_elbow');
    expect(track.target.component).toBe('Transform');
    for (let i = 0; i < 4; i++) expect(track.sampler.values[i]!).toBeCloseTo(q[i]!, 5);
  });

  it('drops tracks for bones the source rig does not map to a humanoid slot', () => {
    const clip = new AnimationClip([rotTrack('some_finger', quat.identity())], 1);
    expect(retargetClip(clip, sourceRig, targetRig).tracks).toHaveLength(0);
  });

  it('scales hip translation by the height ratio in animationScaled mode', () => {
    const hipTranslation: AnimationTrack = {
      target: { targetId: 'src_hips', component: 'Transform', path: [{ kind: 'field', name: 'translation' }] as never },
      // rest is (0,1,0); a keyframe at (0,1.5,0) is a +0.5 delta.
      sampler: {
        times: new Float32Array([0]),
        values: new Float32Array([0, 1.5, 0]),
        componentCount: 3,
        interpolation: 'LINEAR',
      },
    };
    const clip = new AnimationClip([hipTranslation], 0);
    const out = retargetClip(clip, sourceRig, targetRig, { rootTranslationMode: 'animationScaled' });

    expect(out.tracks).toHaveLength(1);
    // tgtRest(2) + ratio(2)·delta(0.5) = 2 + 1.0 = 3.0 on Y
    near(out.tracks[0]!.sampler.values, [0, 3.0, 0]);
  });

  it('drops hip translation entirely in targetBindPose mode', () => {
    const hipTranslation: AnimationTrack = {
      target: { targetId: 'src_hips', component: 'Transform', path: [{ kind: 'field', name: 'translation' }] as never },
      sampler: {
        times: new Float32Array([0]),
        values: new Float32Array([0, 1.5, 0]),
        componentCount: 3,
        interpolation: 'LINEAR',
      },
    };
    const clip = new AnimationClip([hipTranslation], 0);
    const out = retargetClip(clip, sourceRig, targetRig, { rootTranslationMode: 'targetBindPose' });
    expect(out.tracks).toHaveLength(0);
  });
});

function near(a: ArrayLike<number>, b: readonly number[]): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < b.length; i++) expect(a[i]!).toBeCloseTo(b[i]!, 5);
}
