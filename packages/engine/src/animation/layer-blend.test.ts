import { describe, expect, it } from 'bun:test';

import { composeLayerAdditive, composeLayerOverride } from './layer-blend';
import { Pose } from './pose';

/** A finalized one-bone pose with the given local TRS and all weights set. */
const layerPose = (
  t: [number, number, number],
  r: [number, number, number, number],
  s: [number, number, number],
): Pose => {
  const pose = new Pose(1);
  pose.beginAccumulate(1);
  pose.t.set(t, 0);
  pose.r.set(r, 0);
  pose.s.set(s, 0);
  pose.wt[0] = 1;
  pose.wr[0] = 1;
  pose.ws[0] = 1;
  return pose;
};

const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];
const UNIT_SCALE: [number, number, number] = [1, 1, 1];

describe('layer override', () => {
  it('seeds an empty accumulator from the base layer', () => {
    const acc = new Pose(1);
    acc.beginAccumulate(1);
    const base = layerPose([4, 8, 0], IDENTITY, [2, 2, 2]);
    composeLayerOverride(acc, base, 1, undefined);
    expect(acc.t[0]).toBeCloseTo(4, 5);
    expect(acc.t[1]).toBeCloseTo(8, 5);
    expect(acc.s[0]).toBeCloseTo(2, 5);
    expect(acc.wt[0]).toBe(1);
  });

  it('blends toward the upper layer by weight where the accumulator has a value', () => {
    const acc = new Pose(1);
    acc.beginAccumulate(1);
    composeLayerOverride(acc, layerPose([0, 0, 0], IDENTITY, UNIT_SCALE), 1, undefined);
    composeLayerOverride(acc, layerPose([10, 0, 0], IDENTITY, UNIT_SCALE), 0.25, undefined);
    expect(acc.t[0]).toBeCloseTo(2.5, 5); // lerp(0, 10, 0.25)
  });

  it('leaves masked-out bones at the accumulated value', () => {
    const acc = new Pose(2);
    acc.beginAccumulate(2);
    // Base over two bones.
    const base = new Pose(2);
    base.beginAccumulate(2);
    base.t.set([1, 0, 0, 2, 0, 0], 0);
    base.wt[0] = 1;
    base.wt[1] = 1;
    composeLayerOverride(acc, base, 1, undefined);
    // Upper layer wants to move both bones, but the mask only includes bone 0.
    const upper = new Pose(2);
    upper.beginAccumulate(2);
    upper.t.set([9, 0, 0, 9, 0, 0], 0);
    upper.wt[0] = 1;
    upper.wt[1] = 1;
    composeLayerOverride(acc, upper, 1, Uint8Array.of(1, 0));
    expect(acc.t[0]).toBeCloseTo(9, 5); // bone 0 included → overridden
    expect(acc.t[3]).toBeCloseTo(2, 5); // bone 1 masked out → base shows through
  });

  it('is a no-op at zero weight', () => {
    const acc = new Pose(1);
    acc.beginAccumulate(1);
    composeLayerOverride(acc, layerPose([5, 0, 0], IDENTITY, UNIT_SCALE), 1, undefined);
    composeLayerOverride(acc, layerPose([99, 0, 0], IDENTITY, UNIT_SCALE), 0, undefined);
    expect(acc.t[0]).toBeCloseTo(5, 5);
  });
});

describe('layer additive', () => {
  const reference = (): Pose => layerPose([0, 0, 0], IDENTITY, UNIT_SCALE);

  it('adds nothing when the layer equals the reference', () => {
    const acc = new Pose(1);
    acc.beginAccumulate(1);
    composeLayerOverride(acc, layerPose([3, 0, 0], IDENTITY, [2, 2, 2]), 1, undefined);
    composeLayerAdditive(acc, reference(), reference(), 1, undefined);
    expect(acc.t[0]).toBeCloseTo(3, 5);
    expect(acc.s[0]).toBeCloseTo(2, 5);
  });

  it('adds the weighted translation delta on top of the base', () => {
    const acc = new Pose(1);
    acc.beginAccumulate(1);
    composeLayerOverride(acc, layerPose([5, 0, 0], IDENTITY, UNIT_SCALE), 1, undefined);
    // delta = (2,0,0) − (0,0,0); weight 0.5 → +1.
    composeLayerAdditive(acc, layerPose([2, 0, 0], IDENTITY, UNIT_SCALE), reference(), 0.5, undefined);
    expect(acc.t[0]).toBeCloseTo(6, 5);
  });

  it('rotates the base by the delta-from-reference at full weight', () => {
    const acc = new Pose(1);
    acc.beginAccumulate(1);
    composeLayerOverride(acc, layerPose([0, 0, 0], IDENTITY, UNIT_SCALE), 1, undefined);
    // 90° about Z as the additive layer pose; reference is identity, base is identity.
    const s = Math.SQRT1_2;
    composeLayerAdditive(acc, layerPose([0, 0, 0], [0, 0, s, s], UNIT_SCALE), reference(), 1, undefined);
    expect(acc.r[2]).toBeCloseTo(s, 5);
    expect(acc.r[3]).toBeCloseTo(s, 5);
  });

  it('multiplies scale by the weighted ratio', () => {
    const acc = new Pose(1);
    acc.beginAccumulate(1);
    composeLayerOverride(acc, layerPose([0, 0, 0], IDENTITY, [2, 2, 2]), 1, undefined);
    // ratio = 2/1 = 2; weight 0.5 → factor lerp(1,2,0.5)=1.5; 2 · 1.5 = 3.
    composeLayerAdditive(acc, layerPose([0, 0, 0], IDENTITY, [2, 2, 2]), reference(), 0.5, undefined);
    expect(acc.s[0]).toBeCloseTo(3, 5);
  });
});
