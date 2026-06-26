// Retarget clip-bake hot path (ADR-0122). Retargeting is a clip-production step:
// `retargetClip` re-bakes a source clip's bone tracks onto a target rig, so its
// cost grows with bones (retarget chains) × keyframes. This bench isolates that
// pure transform (no ECS) across representative skeleton sizes and clip lengths.
//
// See docs/adr/ADR-0017 (bench schema).

import { quat, vec3 } from '@retro-engine/math';
import { bench, summary } from 'mitata';

import type { AnimationTrack } from '../src/animation/animation-clip';
import { AnimationClip } from '../src/animation/animation-clip';
import { HUMANOID_SLOTS } from '../src/animation/retarget/humanoid';
import { retargetClip } from '../src/animation/retarget/retarget-clip';
import type { RetargetSlot } from '../src/animation/retarget/retarget-rig';
import { RetargetRig } from '../src/animation/retarget/retarget-rig';

const KEYFRAME_COUNTS = [8, 30, 120] as const;

const FIELD_PATH = [{ kind: 'field', name: 'rotation' }] as const;
const TRANSLATION_PATH = [{ kind: 'field', name: 'translation' }] as const;

const makeRig = (hipHeight: number): RetargetRig => {
  const slots: RetargetSlot[] = HUMANOID_SLOTS.map((slot, i) => ({
    slot,
    boneId: slot,
    restT: vec3.create(0, i === 0 ? hipHeight : 0.2, 0),
    restR: quat.identity(),
    restS: vec3.create(1, 1, 1),
    restWorldT: vec3.create(0, slot === 'Hips' ? hipHeight : 0, 0),
    restWorldR: quat.identity(),
    parentRestWorldR: quat.identity(),
    refWorldR: quat.identity(),
    parentRefWorldR: quat.identity(),
  }));
  return new RetargetRig(slots);
};

const makeClip = (keyframes: number): AnimationClip => {
  const times = new Float32Array(keyframes);
  for (let k = 0; k < keyframes; k++) times[k] = k / Math.max(1, keyframes - 1);

  const tracks: AnimationTrack[] = HUMANOID_SLOTS.map((slot, i) => {
    const values = new Float32Array(keyframes * 4);
    for (let k = 0; k < keyframes; k++) {
      const a = (k / keyframes) * (0.3 + i * 0.01);
      const q = quat.fromEuler(a, a * 0.5, a * 0.25, 'xyz');
      values.set(q, k * 4);
    }
    return {
      target: { targetId: slot, component: 'Transform', path: FIELD_PATH as never },
      sampler: { times, values, componentCount: 4, interpolation: 'LINEAR' as const },
    };
  });

  // A hip translation track so the root-translation scaling path is exercised.
  const hipT = new Float32Array(keyframes * 3);
  for (let k = 0; k < keyframes; k++) hipT.set([0, Math.sin(k) * 0.05, 0], k * 3);
  tracks.push({
    target: { targetId: 'Hips', component: 'Transform', path: TRANSLATION_PATH as never },
    sampler: { times, values: hipT, componentCount: 3, interpolation: 'LINEAR' as const },
  });

  return new AnimationClip(tracks, times[keyframes - 1] ?? 0);
};

const sourceRig = makeRig(1);
const targetRig = makeRig(1.4); // taller target → exercises proportion scaling

summary(() => {
  for (const keyframes of KEYFRAME_COUNTS) {
    const clip = makeClip(keyframes);
    bench(`retarget clip @ ${HUMANOID_SLOTS.length} bones × ${keyframes} keyframes`, function* () {
      yield () => retargetClip(clip, sourceRig, targetRig);
    });
  }
});
