import { describe, expect, it } from 'bun:test';

import {
  accumulateRotation,
  accumulateScale,
  accumulateTranslation,
  finalizePose,
} from './pose-blend';
import { Pose } from './pose';

describe('pose blend', () => {
  it('weighted-averages translation and scale by accumulated weight', () => {
    const pose = new Pose(1);
    pose.beginAccumulate(1);
    accumulateTranslation(pose, 0, 0, 0, 0, 0.25);
    accumulateTranslation(pose, 0, 4, 8, 0, 0.75);
    accumulateScale(pose, 0, 1, 1, 1, 0.5);
    accumulateScale(pose, 0, 3, 3, 3, 0.5);
    finalizePose(pose);
    expect(pose.t[0]).toBeCloseTo(3, 5); // (0·0.25 + 4·0.75)/1
    expect(pose.t[1]).toBeCloseTo(6, 5);
    expect(pose.s[0]).toBeCloseTo(2, 5);
  });

  it('sign-aligns antipodal-equal quaternions instead of cancelling them', () => {
    const pose = new Pose(1);
    pose.beginAccumulate(1);
    // (0,0,0,1) and (0,0,0,-1) are the same rotation; a naive average is the
    // zero quaternion. Sign-aligned nlerp must recover the identity.
    accumulateRotation(pose, 0, 0, 0, 0, 1, 0.5);
    accumulateRotation(pose, 0, 0, 0, 0, -1, 0.5);
    finalizePose(pose);
    expect(pose.r[0]).toBeCloseTo(0, 5);
    expect(pose.r[1]).toBeCloseTo(0, 5);
    expect(pose.r[2]).toBeCloseTo(0, 5);
    expect(Math.abs(pose.r[3]!)).toBeCloseTo(1, 5);
  });

  it('blends two distinct rotations into a unit quaternion', () => {
    const pose = new Pose(1);
    pose.beginAccumulate(1);
    // identity and a 90° rotation about Z (w = cos45, z = sin45).
    const s = Math.SQRT1_2;
    accumulateRotation(pose, 0, 0, 0, 0, 1, 0.5);
    accumulateRotation(pose, 0, 0, 0, s, s, 0.5);
    finalizePose(pose);
    const len = Math.hypot(pose.r[0]!, pose.r[1]!, pose.r[2]!, pose.r[3]!);
    expect(len).toBeCloseTo(1, 5);
    expect(pose.r[2]).toBeGreaterThan(0); // partway toward the +Z rotation
    expect(pose.r[3]).toBeGreaterThan(pose.r[2]!); // still closer to identity
  });

  it('leaves a field untouched when no source animated it', () => {
    const pose = new Pose(1);
    pose.beginAccumulate(1);
    accumulateRotation(pose, 0, 0, 0, 0, 1, 1);
    finalizePose(pose);
    // No translation/scale contribution → their weights stay zero.
    expect(pose.wt[0]).toBe(0);
    expect(pose.ws[0]).toBe(0);
    expect(pose.wr[0]).toBe(1);
  });
});
