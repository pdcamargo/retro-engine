import { quat, vec3 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import {
  bodyFrameAlignment,
  proportionRatio,
  scaleRootTranslation,
  transferRotation,
} from './retarget-transfer';

const I = () => quat.identity();
const near = (a: ArrayLike<number>, b: readonly number[]): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < b.length; i++) expect(a[i]!).toBeCloseTo(b[i]!, 5);
};

describe('transferRotation (world-space)', () => {
  it('copies the source rotation when both rigs share an identity bind', () => {
    const srcAnim = quat.fromEuler(0.3, -0.2, 0.5, 'xyz');
    const out = transferRotation(I(), I(), srcAnim, I(), I(), quat.create());
    near(out, [...srcAnim]);
  });

  it('preserves the world delta-from-bind across rigs with different bind orientations', () => {
    // Source and target bones rest in different world orientations; a transfer
    // must keep the bone's world-space rotation *relative to its own bind* equal
    // on both rigs. Build arbitrary parent/bone bind worlds and a source local.
    const srcParent = quat.fromEuler(0.1, 0.2, -0.3, 'xyz');
    const srcRest = quat.fromEuler(0.4, -0.1, 0.2, 'xyz'); // bone world bind
    const tgtParent = quat.fromEuler(-0.5, 0.3, 0.15, 'xyz');
    const tgtRest = quat.fromEuler(0.2, 0.6, -0.4, 'xyz');
    const srcLocal = quat.fromEuler(0.25, 0.1, -0.2, 'xyz');

    const tgtLocal = transferRotation(srcParent, srcRest, srcLocal, tgtParent, tgtRest, quat.create());

    // Reconstruct world rotations (parent assumed at bind) and compare deltas.
    const srcWorld = quat.multiply(srcParent, srcLocal, quat.create());
    const tgtWorld = quat.multiply(tgtParent, tgtLocal, quat.create());
    const srcDelta = quat.multiply(srcWorld, quat.inverse(srcRest, quat.create()), quat.create());
    const tgtDelta = quat.multiply(tgtWorld, quat.inverse(tgtRest, quat.create()), quat.create());
    quat.normalize(srcDelta, srcDelta);
    quat.normalize(tgtDelta, tgtDelta);
    // Quaternions are double-cover; align hemisphere before comparing.
    if (quat.dot(srcDelta, tgtDelta) < 0) for (let i = 0; i < 4; i++) tgtDelta[i] = -tgtDelta[i]!;
    near(tgtDelta, [...srcDelta]);
  });

  it('returns the target rest when the source is at its own rest (no motion)', () => {
    // srcLocal that places the bone at its bind: srcLocal = srcParent⁻¹ · srcRest.
    const srcParent = quat.fromEuler(0.1, 0.2, -0.3, 'xyz');
    const srcRest = quat.fromEuler(0.4, -0.1, 0.2, 'xyz');
    const tgtParent = quat.fromEuler(-0.5, 0.3, 0.15, 'xyz');
    const tgtRest = quat.fromEuler(0.2, 0.6, -0.4, 'xyz');
    const srcLocalRest = quat.multiply(quat.inverse(srcParent, quat.create()), srcRest, quat.create());

    const out = transferRotation(srcParent, srcRest, srcLocalRest, tgtParent, tgtRest, quat.create());
    // target bone at bind: tgtLocalRest = tgtParent⁻¹ · tgtRest
    const tgtLocalRest = quat.multiply(quat.inverse(tgtParent, quat.create()), tgtRest, quat.create());
    if (quat.dot(out, tgtLocalRest) < 0) for (let i = 0; i < 4; i++) out[i] = -out[i]!;
    near(out, [...tgtLocalRest]);
  });
});

describe('bodyFrameAlignment', () => {
  it('is identity when both rigs share a bind orientation', () => {
    const hip = vec3.create(0, 1, 0), head = vec3.create(0, 2, 0);
    const legL = vec3.create(0.5, 0, 0), legR = vec3.create(-0.5, 0, 0);
    const g = bodyFrameAlignment(hip, head, legL, legR, hip, head, legL, legR, quat.create());
    const aligned = vec3.transformQuat(vec3.create(1, 0, 0), g, vec3.create());
    near(aligned, [1, 0, 0]);
  });

  it('recovers the global rotation when the target faces a different way', () => {
    // Source faces +Z (up +Y, left +X). Target is the source rotated 90° about Y,
    // so its left axis points -Z. G must map the source side (+X) onto the target's.
    const hip = vec3.create(0, 1, 0), head = vec3.create(0, 2, 0);
    const sLegL = vec3.create(0.5, 0, 0), sLegR = vec3.create(-0.5, 0, 0);
    const tLegL = vec3.create(0, 0, -0.5), tLegR = vec3.create(0, 0, 0.5);
    const g = bodyFrameAlignment(hip, head, sLegL, sLegR, hip, head, tLegL, tLegR, quat.create());
    const side = vec3.transformQuat(vec3.create(1, 0, 0), g, vec3.create()); // src side +X
    near(side, [0, 0, -1]); // → target side -Z
    const up = vec3.transformQuat(vec3.create(0, 1, 0), g, vec3.create());
    near(up, [0, 1, 0]); // up preserved
  });

  it('falls back to identity for degenerate landmarks', () => {
    const p = vec3.create(0, 0, 0);
    const g = bodyFrameAlignment(p, p, p, p, p, p, p, p, quat.create());
    near(g, [0, 0, 0, 1]);
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
