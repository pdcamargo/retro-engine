import { quat, vec3 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import { proportionRatio, scaleRootTranslation, transferRotation } from './retarget-transfer';

const I = () => quat.identity();
const near = (a: ArrayLike<number>, b: readonly number[]): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < b.length; i++) expect(a[i]!).toBeCloseTo(b[i]!, 5);
};

describe('transferRotation (reference-pose)', () => {
  it('copies the source rotation when both rigs share an identity reference pose', () => {
    const srcAnim = quat.fromEuler(0.3, -0.2, 0.5, 'xyz');
    const out = transferRotation(I(), I(), srcAnim, I(), I(), quat.create());
    near(out, [...srcAnim]);
  });

  it('preserves the world delta-from-reference across rigs whose reference poses differ', () => {
    // Source and target bones sit in different reference-pose world orientations;
    // a transfer must keep the bone's world-space rotation *relative to its own
    // reference pose* equal on both rigs.
    const srcParent = quat.fromEuler(0.1, 0.2, -0.3, 'xyz');
    const srcRef = quat.fromEuler(0.4, -0.1, 0.2, 'xyz'); // bone world reference
    const tgtParent = quat.fromEuler(-0.5, 0.3, 0.15, 'xyz');
    const tgtRef = quat.fromEuler(0.2, 0.6, -0.4, 'xyz');
    const srcLocal = quat.fromEuler(0.25, 0.1, -0.2, 'xyz');

    const tgtLocal = transferRotation(srcParent, srcRef, srcLocal, tgtParent, tgtRef, quat.create());

    // Reconstruct world rotations (parent assumed at reference) and compare deltas.
    const srcWorld = quat.multiply(srcParent, srcLocal, quat.create());
    const tgtWorld = quat.multiply(tgtParent, tgtLocal, quat.create());
    const srcDelta = quat.multiply(srcWorld, quat.inverse(srcRef, quat.create()), quat.create());
    const tgtDelta = quat.multiply(tgtWorld, quat.inverse(tgtRef, quat.create()), quat.create());
    quat.normalize(srcDelta, srcDelta);
    quat.normalize(tgtDelta, tgtDelta);
    // Quaternions are double-cover; align hemisphere before comparing.
    if (quat.dot(srcDelta, tgtDelta) < 0) for (let i = 0; i < 4; i++) tgtDelta[i] = -tgtDelta[i]!;
    near(tgtDelta, [...srcDelta]);
  });

  it('returns the target reference when the source is at its own reference (no motion)', () => {
    // srcLocal that places the bone at its reference: srcLocal = srcParent⁻¹ · srcRef.
    const srcParent = quat.fromEuler(0.1, 0.2, -0.3, 'xyz');
    const srcRef = quat.fromEuler(0.4, -0.1, 0.2, 'xyz');
    const tgtParent = quat.fromEuler(-0.5, 0.3, 0.15, 'xyz');
    const tgtRef = quat.fromEuler(0.2, 0.6, -0.4, 'xyz');
    const srcLocalRef = quat.multiply(quat.inverse(srcParent, quat.create()), srcRef, quat.create());

    const out = transferRotation(srcParent, srcRef, srcLocalRef, tgtParent, tgtRef, quat.create());
    // target bone at reference: tgtLocalRef = tgtParent⁻¹ · tgtRef
    const tgtLocalRef = quat.multiply(quat.inverse(tgtParent, quat.create()), tgtRef, quat.create());
    if (quat.dot(out, tgtLocalRef) < 0) for (let i = 0; i < 4; i++) out[i] = -out[i]!;
    near(out, [...tgtLocalRef]);
  });
});

describe('proportionRatio', () => {
  it('is the target/source hip-height ratio', () => {
    expect(proportionRatio(1, 1.5)).toBeCloseTo(1.5, 6);
    expect(proportionRatio(2, 1)).toBeCloseTo(0.5, 6);
  });

  it('falls back to 1 for a degenerate source height', () => {
    expect(proportionRatio(0, 1.5)).toBe(1);
  });
});

describe('scaleRootTranslation', () => {
  const srcRest = vec3.create(0, 1, 0);
  const tgtRest = vec3.create(0, 1.4, 0);

  it('holds the target rest stance in targetBindPose mode', () => {
    const anim = vec3.create(0.5, 1.2, -0.3);
    const out = scaleRootTranslation(srcRest, anim, tgtRest, 1.4, I(), 'targetBindPose', vec3.create());
    near(out, [0, 1.4, 0]);
  });

  it('adds the scaled motion delta in animationScaled mode with an identity frame', () => {
    // delta = anim - srcRest = (0.5, 0.2, -0.3); out = tgtRest + ratio·delta
    const anim = vec3.create(0.5, 1.2, -0.3);
    const out = scaleRootTranslation(srcRest, anim, tgtRest, 2, I(), 'animationScaled', vec3.create());
    near(out, [1.0, 1.4 + 0.4, -0.6]);
  });

  it('re-bases the motion delta by the frame rotation', () => {
    // A 90° turn about Y maps +X to -Z. delta = (0.5,0,0) -> (0,0,-0.5), ×ratio 2.
    const frame = quat.fromEuler(0, Math.PI / 2, 0, 'xyz');
    const anim = vec3.create(0.5, 1, 0);
    const out = scaleRootTranslation(srcRest, anim, tgtRest, 2, frame, 'animationScaled', vec3.create());
    near(out, [0, 1.4, -1.0]);
  });
});
