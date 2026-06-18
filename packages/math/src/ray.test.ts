import { describe, expect, it } from 'bun:test';
import { mat4, vec3 } from 'wgpu-matrix';

import { Aabb } from './aabb';
import { Plane } from './plane';
import { Ray, rayAabbIntersect, rayClosestPointToRay, rayPlaneIntersect, signedAngleOnPlane } from './ray';

const expectVec3Close = (actual: Float32Array | number[], expected: [number, number, number]) => {
  expect(actual[0]).toBeCloseTo(expected[0], 4);
  expect(actual[1]).toBeCloseTo(expected[1], 4);
  expect(actual[2]).toBeCloseTo(expected[2], 4);
};

describe('Ray', () => {
  describe('at', () => {
    it('walks along the unit direction', () => {
      const ray = new Ray(vec3.create(1, 2, 3), vec3.create(0, 0, -2));
      expectVec3Close(ray.direction, [0, 0, -1]); // normalised on construction
      expectVec3Close(ray.at(4), [1, 2, -1]);
    });
  });

  describe('fromScreen', () => {
    it('perspective: centre pixel points down the camera forward axis', () => {
      const proj = mat4.perspective(Math.PI / 4, 1, 0.1, 100);
      const view = mat4.lookAt(vec3.create(0, 0, 5), vec3.create(0, 0, 0), vec3.create(0, 1, 0));
      const invViewProj = mat4.inverse(mat4.multiply(proj, view));
      const ray = Ray.fromScreen(400, 300, 0, 0, 800, 600, invViewProj);
      expectVec3Close(ray.direction, [0, 0, -1]);
      // Origin sits on the near plane, one near-distance in front of the eye.
      expect(ray.origin[2]).toBeCloseTo(5 - 0.1, 3);
    });

    it('orthographic: every pixel yields the same (parallel) direction', () => {
      const proj = mat4.ortho(-10, 10, -10, 10, 0.1, 100);
      const view = mat4.lookAt(vec3.create(0, 0, 5), vec3.create(0, 0, 0), vec3.create(0, 1, 0));
      const invViewProj = mat4.inverse(mat4.multiply(proj, view));
      const centre = Ray.fromScreen(400, 300, 0, 0, 800, 600, invViewProj);
      const corner = Ray.fromScreen(50, 120, 0, 0, 800, 600, invViewProj);
      expectVec3Close(centre.direction, [0, 0, -1]);
      expectVec3Close(corner.direction, [0, 0, -1]);
      // Parallel rays: origins differ but directions match.
      expect(corner.origin[0]).not.toBeCloseTo(centre.origin[0]!, 2);
    });
  });
});

describe('rayPlaneIntersect', () => {
  it('hits a plane in front of the ray at the expected distance', () => {
    const ray = new Ray(vec3.create(0, 0, 5), vec3.create(0, 0, -1));
    const plane = new Plane(vec3.create(0, 0, 1), 0); // z = 0
    const t = rayPlaneIntersect(ray, plane);
    expect(t).toBeCloseTo(5, 5);
    expectVec3Close(ray.at(t), [0, 0, 0]);
  });

  it('returns NaN when the ray is parallel to the plane', () => {
    const ray = new Ray(vec3.create(0, 1, 0), vec3.create(1, 0, 0));
    const plane = new Plane(vec3.create(0, 1, 0), 0); // y = 0, ray runs along x
    expect(Number.isNaN(rayPlaneIntersect(ray, plane))).toBe(true);
  });

  it('returns a negative distance for a plane behind the origin', () => {
    const ray = new Ray(vec3.create(0, 0, 5), vec3.create(0, 0, 1)); // pointing away
    const plane = new Plane(vec3.create(0, 0, 1), 0);
    expect(rayPlaneIntersect(ray, plane)).toBeCloseTo(-5, 5);
  });
});

describe('rayClosestPointToRay', () => {
  it('projects a mouse ray onto a world axis', () => {
    const axis = new Ray(vec3.create(0, 0, 0), vec3.create(1, 0, 0));
    const mouse = new Ray(vec3.create(3, 1, 1), vec3.create(0, 0, -1));
    const { point, tA } = rayClosestPointToRay(axis, mouse);
    expect(tA).toBeCloseTo(3, 5);
    expectVec3Close(point, [3, 0, 0]);
  });

  it('falls back to t = 0 for parallel lines', () => {
    const a = new Ray(vec3.create(0, 0, 0), vec3.create(1, 0, 0));
    const b = new Ray(vec3.create(0, 2, 0), vec3.create(1, 0, 0));
    const { tA, tB } = rayClosestPointToRay(a, b);
    expect(tA).toBe(0);
    expect(tB).toBe(0);
  });
});

describe('rayAabbIntersect', () => {
  const unitBox = new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1));

  it('returns the entry distance for a head-on hit', () => {
    const ray = new Ray(vec3.create(0, 0, 5), vec3.create(0, 0, -1));
    expect(rayAabbIntersect(ray, unitBox)).toBeCloseTo(4, 5); // enters at z = 1
  });

  it('returns 0 when the origin is inside the box', () => {
    const ray = new Ray(vec3.create(0, 0, 0), vec3.create(1, 0, 0));
    expect(rayAabbIntersect(ray, unitBox)).toBe(0);
  });

  it('misses a box the ray passes beside', () => {
    const ray = new Ray(vec3.create(3, 3, 5), vec3.create(0, 0, -1));
    expect(rayAabbIntersect(ray, unitBox)).toBeNull();
  });

  it('misses a box entirely behind the origin', () => {
    const ray = new Ray(vec3.create(0, 0, 5), vec3.create(0, 0, 1));
    expect(rayAabbIntersect(ray, unitBox)).toBeNull();
  });

  it('handles an axis-parallel ray that grazes outside its slab', () => {
    const ray = new Ray(vec3.create(0, 2, 5), vec3.create(0, 0, -1));
    expect(rayAabbIntersect(ray, unitBox)).toBeNull();
  });

  it('picks the nearer of two boxes by comparing t', () => {
    const ray = new Ray(vec3.create(0, 0, 10), vec3.create(0, 0, -1));
    const near = new Aabb(vec3.create(0, 0, 4), vec3.create(1, 1, 1));
    const far = new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1));
    const tNear = rayAabbIntersect(ray, near)!;
    const tFar = rayAabbIntersect(ray, far)!;
    expect(tNear).toBeLessThan(tFar);
  });
});

describe('signedAngleOnPlane', () => {
  const z = vec3.create(0, 0, 1);

  it('is +90° rotating +X to +Y about +Z', () => {
    expect(signedAngleOnPlane(vec3.create(1, 0, 0), vec3.create(0, 1, 0), z)).toBeCloseTo(Math.PI / 2, 5);
  });

  it('flips sign with the plane normal', () => {
    const negZ = vec3.create(0, 0, -1);
    expect(signedAngleOnPlane(vec3.create(1, 0, 0), vec3.create(0, 1, 0), negZ)).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('is ±π for opposed vectors', () => {
    expect(Math.abs(signedAngleOnPlane(vec3.create(1, 0, 0), vec3.create(-1, 0, 0), z))).toBeCloseTo(Math.PI, 5);
  });
});
