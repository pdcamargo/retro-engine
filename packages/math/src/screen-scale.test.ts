import { describe, expect, it } from 'bun:test';
import { mat4, vec3 } from 'wgpu-matrix';

import { screenSpaceScale } from './screen-scale';

const perspectiveViewProj = (cameraDistance: number) => {
  const proj = mat4.perspective(Math.PI / 4, 1, 0.1, 100);
  const view = mat4.lookAt(vec3.create(0, 0, cameraDistance), vec3.create(0, 0, 0), vec3.create(0, 1, 0));
  return mat4.multiply(proj, view);
};

const orthoViewProj = (cameraDistance: number) => {
  const proj = mat4.ortho(-10, 10, -10, 10, 0.1, 100);
  const view = mat4.lookAt(vec3.create(0, 0, cameraDistance), vec3.create(0, 0, 0), vec3.create(0, 1, 0));
  return mat4.multiply(proj, view);
};

describe('screenSpaceScale', () => {
  const pivot = vec3.create(0, 0, 0);

  it('perspective: factor grows in proportion to camera distance', () => {
    const near = screenSpaceScale(pivot, perspectiveViewProj(5), 600, 100);
    const far = screenSpaceScale(pivot, perspectiveViewProj(10), 600, 100);
    expect(near).toBeGreaterThan(0);
    expect(far / near).toBeCloseTo(2, 3);
  });

  it('orthographic: factor is independent of camera distance', () => {
    const near = screenSpaceScale(pivot, orthoViewProj(5), 600, 100);
    const far = screenSpaceScale(pivot, orthoViewProj(50), 600, 100);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeCloseTo(near, 5);
  });

  it('scales linearly with the requested pixel size', () => {
    const vp = perspectiveViewProj(8);
    const small = screenSpaceScale(pivot, vp, 600, 50);
    const big = screenSpaceScale(pivot, vp, 600, 100);
    expect(big / small).toBeCloseTo(2, 5);
  });

  it('returns 0 when the pivot is at the camera (degenerate w)', () => {
    const vp = perspectiveViewProj(5);
    expect(screenSpaceScale(vec3.create(0, 0, 5), vp, 600, 100)).toBe(0);
  });
});
