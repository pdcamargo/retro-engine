import { describe, expect, it } from 'bun:test';

import type { Mat4 } from '@retro-engine/math';
import { mat4, quat, vec3, vec4 } from '@retro-engine/math';

import { MAX_SHADOW_CASTERS, NO_SHADOW_CASTER } from './gpu-lights';
import {
  assignCasterLayer,
  directionalLightViewProj,
  spotLightViewProj,
} from './shadow-3d-matrices';
import { Shadow3dSettings } from './shadow-3d-settings';

// Project a world point through a column-major view-proj and perspective-divide.
const project = (viewProj: Mat4, x: number, y: number, z: number): [number, number, number] => {
  const clip = vec4.transformMat4(vec4.create(x, y, z, 1), viewProj);
  const w = clip[3] as number;
  return [(clip[0] as number) / w, (clip[1] as number) / w, (clip[2] as number) / w];
};

// Column-major transform from rotation about an axis at a translation.
const transform = (axis: [number, number, number], angle: number, pos: [number, number, number]): Mat4 => {
  const r = quat.fromAxisAngle(vec3.create(...axis), angle);
  const m = mat4.fromQuat(r);
  m[12] = pos[0];
  m[13] = pos[1];
  m[14] = pos[2];
  return m as Mat4;
};

describe('directionalLightViewProj', () => {
  const settings = new Shadow3dSettings({ directionalExtent: 10, near: 0.5, far: 60 });

  it('maps the world origin to the centre of the shadow map, within depth range', () => {
    // Identity rotation → forward = -Z, eye placed on +Z looking at the origin.
    const vp = directionalLightViewProj(mat4.identity() as Mat4, settings, mat4.identity() as Mat4);
    const [x, y, z] = project(vp, 0, 0, 0);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(1);
  });

  it('projects a point beyond the extent outside the [-1, 1] NDC box', () => {
    const vp = directionalLightViewProj(mat4.identity() as Mat4, settings, mat4.identity() as Mat4);
    const [x] = project(vp, settings.directionalExtent * 2, 0, 0);
    expect(Math.abs(x)).toBeGreaterThan(1);
  });

  it('keeps a point inside the extent within the NDC box', () => {
    const vp = directionalLightViewProj(mat4.identity() as Mat4, settings, mat4.identity() as Mat4);
    const [x, y] = project(vp, settings.directionalExtent * 0.5, settings.directionalExtent * 0.5, 0);
    expect(Math.abs(x)).toBeLessThanOrEqual(1);
    expect(Math.abs(y)).toBeLessThanOrEqual(1);
  });
});

describe('spotLightViewProj', () => {
  const settings = new Shadow3dSettings({ near: 0.5 });

  it('projects a fragment along the cone axis to the map centre, in front of the light', () => {
    // Light at (0, 5, 0) aimed straight down (-Y): rotate -Z onto -Y is +90° about X.
    const gt = transform([1, 0, 0], -Math.PI / 2, [0, 5, 0]);
    const vp = spotLightViewProj(gt, Math.PI / 6, 14, settings, mat4.identity() as Mat4);
    // A point directly below the light, within range.
    const [x, y, z] = project(vp, 0, 1, 0);
    expect(x).toBeCloseTo(0, 4);
    expect(y).toBeCloseTo(0, 4);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(1);
  });
});

describe('assignCasterLayer', () => {
  it('returns the layer index while under budget', () => {
    for (let i = 0; i < MAX_SHADOW_CASTERS; i++) {
      expect(assignCasterLayer(i)).toBe(i);
    }
  });

  it('returns NO_SHADOW_CASTER once the budget is exhausted', () => {
    expect(assignCasterLayer(MAX_SHADOW_CASTERS)).toBe(NO_SHADOW_CASTER);
    expect(assignCasterLayer(MAX_SHADOW_CASTERS + 5)).toBe(NO_SHADOW_CASTER);
  });
});
