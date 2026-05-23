import { describe, expect, it } from 'bun:test';
import { mat4, vec3 } from 'wgpu-matrix';

import { Aabb } from './aabb';
import { Frustum, frustumIntersectsAabb } from './frustum';

// Build a view matrix for a camera at `eye` looking at `target` with world up
// `(0, 1, 0)`. The view matrix is the inverse of the camera's world transform.
const lookAtView = (eye: [number, number, number], target: [number, number, number]) => {
  return mat4.lookAt(vec3.create(...eye), vec3.create(...target), vec3.create(0, 1, 0));
};

const perspectiveViewProj = (
  eye: [number, number, number],
  target: [number, number, number],
  fov = Math.PI / 4,
  aspect = 1,
  near = 0.1,
  far = 100,
) => {
  const view = lookAtView(eye, target);
  const proj = mat4.perspective(fov, aspect, near, far);
  return mat4.multiply(proj, view);
};

describe('Frustum.fromViewProj', () => {
  it('perspective frustum — origin (a point inside) has every plane positive', () => {
    const vp = perspectiveViewProj([0, 0, 5], [0, 0, 0]);
    const f = Frustum.fromViewProj(vp);
    const origin = vec3.create(0, 0, 0);
    for (let i = 0; i < 6; i++) {
      expect(f.planes[i]!.signedDistance(origin)).toBeGreaterThan(0);
    }
  });

  it('orthographic frustum — point at the origin (inside the box) is positive against every plane', () => {
    const view = lookAtView([0, 0, 5], [0, 0, 0]);
    const proj = mat4.ortho(-2, 2, -2, 2, 0.1, 100);
    const vp = mat4.multiply(proj, view);
    const f = Frustum.fromViewProj(vp);
    const origin = vec3.create(0, 0, 0);
    for (let i = 0; i < 6; i++) {
      expect(f.planes[i]!.signedDistance(origin)).toBeGreaterThan(0);
    }
  });

  it('plane normals are unit length after extraction', () => {
    const vp = perspectiveViewProj([1, 2, 5], [0, 0, 0]);
    const f = Frustum.fromViewProj(vp);
    for (let i = 0; i < 6; i++) {
      const n = f.planes[i]!.normal;
      const len = Math.hypot(n[0]!, n[1]!, n[2]!);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('writes into the supplied dst', () => {
    const dst = new Frustum();
    const vp = perspectiveViewProj([0, 0, 5], [0, 0, 0]);
    const result = Frustum.fromViewProj(vp, dst);
    expect(result).toBe(dst);
  });
});

describe('frustumIntersectsAabb', () => {
  // Camera at +Z=5, looking toward the origin. The default perspective covers
  // a wedge centred on -Z up to far=100.
  const vp = perspectiveViewProj([0, 0, 5], [0, 0, 0]);
  const frustum = Frustum.fromViewProj(vp);

  it('returns true for a small box at the origin (inside)', () => {
    const aabb = new Aabb(vec3.create(0, 0, 0), vec3.create(0.5, 0.5, 0.5));
    expect(frustumIntersectsAabb(frustum, aabb)).toBe(true);
  });

  it('returns false for a box behind the camera (positive Z, past the near plane)', () => {
    const aabb = new Aabb(vec3.create(0, 0, 50), vec3.create(0.5, 0.5, 0.5));
    expect(frustumIntersectsAabb(frustum, aabb)).toBe(false);
  });

  it('returns false for a box far past the far plane', () => {
    const aabb = new Aabb(vec3.create(0, 0, -500), vec3.create(0.5, 0.5, 0.5));
    expect(frustumIntersectsAabb(frustum, aabb)).toBe(false);
  });

  it('returns false for a box far off to the side', () => {
    const aabb = new Aabb(vec3.create(500, 0, 0), vec3.create(0.5, 0.5, 0.5));
    expect(frustumIntersectsAabb(frustum, aabb)).toBe(false);
  });

  it('returns true when a box straddles the near plane (partial overlap)', () => {
    // Camera at +Z=5 looking at origin; near=0.1 means the near plane is at Z≈4.9 world.
    const aabb = new Aabb(vec3.create(0, 0, 4.5), vec3.create(2, 2, 2));
    expect(frustumIntersectsAabb(frustum, aabb)).toBe(true);
  });
});
