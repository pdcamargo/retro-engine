import { describe, expect, it } from 'bun:test';

import { buildHumanoidRetargetRig } from '../animation/retarget/retarget-rig';
import { App } from '../index';
import { makeRenderingRenderer } from '../test-utils';
import { parseMakeHumanRig } from './makehuman-rig';
import { buildRigPose } from './rig-pose';
import { spawnRig } from './spawn-rig';

// A MakeHuman `game_engine`-style (Unreal mannequin) skeleton: the bone naming
// the RetroHuman preset spawns. Positions are nominal; only the hierarchy +
// names drive humanoid slot mapping.
const bone = (head: number[], tail: number[], parent: string) => ({
  head: { default_position: head },
  tail: { default_position: tail },
  parent,
});
const RIG = JSON.stringify({
  Root: bone([0, 0, 0], [0, 0.1, 0], ''),
  pelvis: bone([0, 1, 0], [0, 1.1, 0], 'Root'),
  spine_01: bone([0, 1.2, 0], [0, 1.4, 0], 'pelvis'),
  spine_02: bone([0, 1.4, 0], [0, 1.6, 0], 'spine_01'),
  spine_03: bone([0, 1.6, 0], [0, 1.8, 0], 'spine_02'),
  neck_01: bone([0, 1.8, 0], [0, 1.9, 0], 'spine_03'),
  head: bone([0, 1.9, 0], [0, 2.1, 0], 'neck_01'),
  clavicle_l: bone([0.05, 1.7, 0], [0.2, 1.7, 0], 'spine_03'),
  upperarm_l: bone([0.2, 1.7, 0], [0.45, 1.7, 0], 'clavicle_l'),
  lowerarm_l: bone([0.45, 1.7, 0], [0.7, 1.7, 0], 'upperarm_l'),
  hand_l: bone([0.7, 1.7, 0], [0.8, 1.7, 0], 'lowerarm_l'),
  clavicle_r: bone([-0.05, 1.7, 0], [-0.2, 1.7, 0], 'spine_03'),
  upperarm_r: bone([-0.2, 1.7, 0], [-0.45, 1.7, 0], 'clavicle_r'),
  lowerarm_r: bone([-0.45, 1.7, 0], [-0.7, 1.7, 0], 'upperarm_r'),
  hand_r: bone([-0.7, 1.7, 0], [-0.8, 1.7, 0], 'lowerarm_r'),
  thigh_l: bone([0.1, 1, 0], [0.1, 0.5, 0], 'pelvis'),
  calf_l: bone([0.1, 0.5, 0], [0.1, 0.1, 0], 'thigh_l'),
  foot_l: bone([0.1, 0.1, 0], [0.1, 0, 0.1], 'calf_l'),
  ball_l: bone([0.1, 0, 0.1], [0.1, 0, 0.2], 'foot_l'),
  thigh_r: bone([-0.1, 1, 0], [-0.1, 0.5, 0], 'pelvis'),
  calf_r: bone([-0.1, 0.5, 0], [-0.1, 0.1, 0], 'thigh_r'),
  foot_r: bone([-0.1, 0.1, 0], [-0.1, 0, 0.1], 'calf_r'),
  ball_r: bone([-0.1, 0, 0.1], [-0.1, 0, 0.2], 'foot_r'),
});

describe('RetroHuman → humanoid retarget', () => {
  it('auto-maps a spawned game_engine skeleton onto the humanoid retarget rig', () => {
    const app = new App({ renderer: makeRenderingRenderer() });
    const rig = parseMakeHumanRig(RIG);
    const { joints } = spawnRig(app.world, buildRigPose(rig), { names: rig.bones.map((b) => b.name) });

    // The binding path: walk the named skeleton from its root, map bones to slots.
    const retarget = buildHumanoidRetargetRig(app.world, joints[0]!, 'retrohuman');

    const mapped = new Set(retarget.slots.map((s) => s.slot));
    for (const slot of [
      'Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head',
      'LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand',
      'RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand',
      'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes',
      'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes',
    ]) {
      expect(mapped.has(slot as never)).toBe(true);
    }
    // Each slot resolves to its bone id (the bone name, absent an AnimationTarget).
    expect(retarget.bySlot.get('LeftLowerArm')?.boneId).toBe('lowerarm_l');
    expect(retarget.bySlot.get('Hips')?.boneId).toBe('pelvis');
  });
});
