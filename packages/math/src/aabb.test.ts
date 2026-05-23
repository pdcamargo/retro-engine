import { describe, expect, it } from 'bun:test';
import { mat4, vec3 } from 'wgpu-matrix';

import { Aabb } from './aabb';

const expectVec3Close = (actual: Float32Array | number[], expected: [number, number, number], eps = 1e-5) => {
  expect(actual[0]).toBeCloseTo(expected[0], 5);
  expect(actual[1]).toBeCloseTo(expected[1], 5);
  expect(actual[2]).toBeCloseTo(expected[2], 5);
  void eps;
};

describe('Aabb', () => {
  describe('fromMinMax', () => {
    it('derives centre and half-extents', () => {
      const aabb = Aabb.fromMinMax(vec3.create(-1, 0, 2), vec3.create(3, 4, 6));
      expectVec3Close(aabb.center, [1, 2, 4]);
      expectVec3Close(aabb.halfExtents, [2, 2, 2]);
    });
  });

  describe('fromPoints', () => {
    it('handles an empty Vec3 array', () => {
      const aabb = Aabb.fromPoints([]);
      expectVec3Close(aabb.center, [0, 0, 0]);
      expectVec3Close(aabb.halfExtents, [0, 0, 0]);
    });

    it('finds tight bounds over a small point cloud', () => {
      const aabb = Aabb.fromPoints([
        vec3.create(-1, -2, -3),
        vec3.create(4, 5, 6),
        vec3.create(0, 0, 0),
      ]);
      expectVec3Close(aabb.center, [1.5, 1.5, 1.5]);
      expectVec3Close(aabb.halfExtents, [2.5, 3.5, 4.5]);
    });

    it('handles a flat Float32Array of triples', () => {
      const positions = new Float32Array([-1, -2, -3, 4, 5, 6, 0, 0, 0]);
      const aabb = Aabb.fromPoints(positions);
      expectVec3Close(aabb.center, [1.5, 1.5, 1.5]);
      expectVec3Close(aabb.halfExtents, [2.5, 3.5, 4.5]);
    });

    it('handles a one-point cloud as a zero-extent box', () => {
      const aabb = Aabb.fromPoints([vec3.create(3, -1, 7)]);
      expectVec3Close(aabb.center, [3, -1, 7]);
      expectVec3Close(aabb.halfExtents, [0, 0, 0]);
    });
  });

  describe('transform', () => {
    it('translation only — centre moves, extents unchanged', () => {
      const local = Aabb.fromMinMax(vec3.create(-1, -1, -1), vec3.create(1, 1, 1));
      const m = mat4.translation(vec3.create(5, -3, 2));
      const world = Aabb.transform(local, m);
      expectVec3Close(world.center, [5, -3, 2]);
      expectVec3Close(world.halfExtents, [1, 1, 1]);
    });

    it('uniform scale only — extents scale, centre at origin', () => {
      const local = Aabb.fromMinMax(vec3.create(-1, -2, -3), vec3.create(1, 2, 3));
      const m = mat4.scaling(vec3.create(2, 2, 2));
      const world = Aabb.transform(local, m);
      expectVec3Close(world.center, [0, 0, 0]);
      expectVec3Close(world.halfExtents, [2, 4, 6]);
    });

    it('axis-aligned rotation by 90° about Z swaps X and Y extents', () => {
      const local = Aabb.fromMinMax(vec3.create(-2, -1, -1), vec3.create(2, 1, 1));
      const m = mat4.rotationZ(Math.PI / 2);
      const world = Aabb.transform(local, m);
      expectVec3Close(world.center, [0, 0, 0]);
      expectVec3Close(world.halfExtents, [1, 2, 1]);
    });

    it('45° rotation about Z — bound matches brute-force corner sweep', () => {
      const local = Aabb.fromMinMax(vec3.create(-1, -1, -1), vec3.create(1, 1, 1));
      const m = mat4.rotationZ(Math.PI / 4);
      const world = Aabb.transform(local, m);
      // Diagonal of the unit square along X+Y is √2 ≈ 1.41421
      expectVec3Close(world.center, [0, 0, 0]);
      expectVec3Close(world.halfExtents, [Math.SQRT2, Math.SQRT2, 1]);
    });

    it('aliasing — dst === source is safe', () => {
      const aabb = Aabb.fromMinMax(vec3.create(-1, -1, -1), vec3.create(1, 1, 1));
      const m = mat4.translation(vec3.create(2, 3, 4));
      Aabb.transform(aabb, m, aabb);
      expectVec3Close(aabb.center, [2, 3, 4]);
      expectVec3Close(aabb.halfExtents, [1, 1, 1]);
    });
  });
});
