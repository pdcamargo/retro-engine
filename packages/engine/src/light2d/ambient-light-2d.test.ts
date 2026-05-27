import { describe, expect, it } from 'bun:test';

import { vec2, vec3 } from '@retro-engine/math';

import { GlobalTransform, Transform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

import { AmbientLight2d } from './ambient-light-2d';

describe('AmbientLight2d', () => {
  it('defaults to white, intensity 1, global (no halfExtents)', () => {
    const light = new AmbientLight2d();
    expect(light.color[0]).toBe(1);
    expect(light.color[1]).toBe(1);
    expect(light.color[2]).toBe(1);
    expect(light.intensity).toBe(1);
    expect(light.halfExtents).toBeUndefined();
  });

  it('honours color, intensity, and a regional zone', () => {
    const light = new AmbientLight2d({
      color: vec3.create(1, 0.7, 0.4),
      intensity: 0.5,
      halfExtents: vec2.create(200, 150),
    });
    expect(light.color[1]).toBeCloseTo(0.7);
    expect(light.intensity).toBe(0.5);
    expect(light.halfExtents![0]).toBe(200);
    expect(light.halfExtents![1]).toBe(150);
  });

  it('exposes the canonical visibility / transform requires set (mirrors PointLight2d)', () => {
    expect(AmbientLight2d.requires).toEqual([
      Transform,
      GlobalTransform,
      Visibility,
      InheritedVisibility,
      ViewVisibility,
    ]);
  });
});
