import { mat4, vec3 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import { parseMakeHumanRig } from './makehuman-rig';
import { buildRigPose } from './rig-pose';

const RIG = JSON.stringify({
  Root: { head: { default_position: [0, 0, 0] }, tail: { default_position: [0, 1, 0] }, parent: '' },
  spine: { head: { default_position: [0, 1, 0] }, tail: { default_position: [0, 2, 0] }, parent: 'Root' },
  head: { head: { default_position: [0, 2, 0] }, tail: { default_position: [0, 3, 0] }, parent: 'spine' },
});

describe('buildRigPose', () => {
  it('derives parent chain, local translations, and inverse binds', () => {
    const pose = buildRigPose(parseMakeHumanRig(RIG)); // Root=0, spine=1, head=2

    expect([...pose.parentIndex]).toEqual([-1, 0, 1]);

    // Local translation = head - parentHead (root keeps its head).
    expect([...pose.localTranslations[0]!]).toEqual([0, 0, 0]);
    expect([...pose.localTranslations[1]!]).toEqual([0, 1, 0]);
    expect([...pose.localTranslations[2]!]).toEqual([0, 1, 0]);
  });

  it('inverse bind maps a head-space vertex back to the origin', () => {
    const pose = buildRigPose(parseMakeHumanRig(RIG));
    // inverseBind(spine) · translate(head_spine) = identity, so applying it to
    // the spine head (0,1,0) lands at the origin.
    const v = vec3.transformMat4(vec3.create(0, 1, 0), pose.inverseBindMatrices[1]!, vec3.create());
    expect(v[0]).toBeCloseTo(0, 5);
    expect(v[1]).toBeCloseTo(0, 5);
    expect(v[2]).toBeCloseTo(0, 5);
  });

  it('rest global · inverse bind is identity for every joint', () => {
    const rig = parseMakeHumanRig(RIG);
    const pose = buildRigPose(rig);
    for (let i = 0; i < rig.bones.length; i++) {
      const restGlobal = mat4.translation(rig.bones[i]!.head);
      const product = mat4.multiply(restGlobal, pose.inverseBindMatrices[i]!, mat4.create());
      for (let k = 0; k < 16; k++) expect(product[k]!).toBeCloseTo(mat4.identity()[k] as number, 5);
    }
  });
});
