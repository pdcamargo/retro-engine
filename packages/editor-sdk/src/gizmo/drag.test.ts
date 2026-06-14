import { describe, expect, it } from 'bun:test';
import { quat, vec3 } from '@retro-engine/math';

import { applyRotation, applyScale, applyTranslation, computePivot, restoreTargets, snapshotTargets } from './drag';
import type { GizmoTarget } from './types';

const target = (t: [number, number, number]): GizmoTarget => ({
  translation: vec3.create(...t),
  rotation: quat.identity(),
  scale: vec3.create(1, 1, 1),
});

const close = (v: ArrayLike<number>, e: [number, number, number]) => {
  expect(v[0]).toBeCloseTo(e[0], 4);
  expect(v[1]).toBeCloseTo(e[1], 4);
  expect(v[2]).toBeCloseTo(e[2], 4);
};

describe('computePivot', () => {
  it('is the centroid of the targets', () => {
    const pivot = computePivot([target([0, 0, 0]), target([2, 4, 6])], vec3.create(0, 0, 0));
    close(pivot, [1, 2, 3]);
  });
});

describe('applyTranslation', () => {
  it('moves every target by the same world delta from its snapshot', () => {
    const targets = [target([0, 0, 0]), target([5, 0, 0])];
    const snaps = snapshotTargets(targets);
    applyTranslation(targets, snaps, 1, 2, 3);
    close(targets[0]!.translation, [1, 2, 3]);
    close(targets[1]!.translation, [6, 2, 3]);
  });
});

describe('applyRotation (about shared pivot)', () => {
  it('orbits a single target in place', () => {
    const targets = [target([1, 0, 0])];
    const snaps = snapshotTargets(targets);
    const pivot = vec3.create(1, 0, 0); // pivot at the target → pure spin
    applyRotation(targets, snaps, pivot, vec3.create(0, 1, 0), Math.PI / 2);
    close(targets[0]!.translation, [1, 0, 0]);
  });

  it('orbits an offset target around the pivot', () => {
    const targets = [target([1, 0, 0])];
    const snaps = snapshotTargets(targets);
    const pivot = vec3.create(0, 0, 0);
    // +90° about Y sends +X to -Z (right-handed).
    applyRotation(targets, snaps, pivot, vec3.create(0, 1, 0), Math.PI / 2);
    close(targets[0]!.translation, [0, 0, -1]);
  });
});

describe('applyScale (about shared pivot)', () => {
  it('scales positions and scale components about the pivot', () => {
    const targets = [target([2, 0, 0])];
    targets[0]!.scale[0] = 1;
    const snaps = snapshotTargets(targets);
    const pivot = vec3.create(0, 0, 0);
    applyScale(targets, snaps, pivot, 2, 1, 1);
    close(targets[0]!.translation, [4, 0, 0]);
    expect(targets[0]!.scale[0]).toBeCloseTo(2, 4);
  });
});

describe('restoreTargets', () => {
  it('reverts every target to its snapshot', () => {
    const targets = [target([1, 2, 3])];
    const snaps = snapshotTargets(targets);
    applyTranslation(targets, snaps, 9, 9, 9);
    restoreTargets(targets, snaps);
    close(targets[0]!.translation, [1, 2, 3]);
  });
});
