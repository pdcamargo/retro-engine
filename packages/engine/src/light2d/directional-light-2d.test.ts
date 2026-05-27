import { describe, expect, it } from 'bun:test';

import { vec2, vec3 } from '@retro-engine/math';

import { GlobalTransform, Transform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

import { DirectionalLight2d } from './directional-light-2d';

describe('DirectionalLight2d', () => {
  it('defaults to white, intensity 1, direction (0, -1)', () => {
    const light = new DirectionalLight2d();
    expect(light.color[0]).toBe(1);
    expect(light.color[1]).toBe(1);
    expect(light.color[2]).toBe(1);
    expect(light.intensity).toBe(1);
    expect(light.direction[0]).toBe(0);
    expect(light.direction[1]).toBe(-1);
  });

  it('honours every supplied option', () => {
    const light = new DirectionalLight2d({
      color: vec3.create(0.4, 0.6, 1),
      intensity: 0.75,
      direction: vec2.create(-0.4, -1),
    });
    expect(light.color[2]).toBe(1);
    expect(light.intensity).toBe(0.75);
    expect(light.direction[0]).toBeCloseTo(-0.4);
    expect(light.direction[1]).toBe(-1);
  });

  it('exposes the canonical visibility / transform requires set (mirrors PointLight2d)', () => {
    expect(DirectionalLight2d.requires).toEqual([
      Transform,
      GlobalTransform,
      Visibility,
      InheritedVisibility,
      ViewVisibility,
    ]);
  });
});
