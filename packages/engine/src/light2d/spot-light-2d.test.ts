import { describe, expect, it } from 'bun:test';

import { vec2, vec3 } from '@retro-engine/math';

import { GlobalTransform, Transform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

import { SpotLight2d } from './spot-light-2d';

describe('SpotLight2d', () => {
  it('defaults to white, intensity 1, range 100, radius 0, +X cone of 22.5°/45°', () => {
    const light = new SpotLight2d();
    expect(light.color[0]).toBe(1);
    expect(light.color[1]).toBe(1);
    expect(light.color[2]).toBe(1);
    expect(light.intensity).toBe(1);
    expect(light.range).toBe(100);
    expect(light.radius).toBe(0);
    expect(light.direction[0]).toBe(1);
    expect(light.direction[1]).toBe(0);
    expect(light.innerAngle).toBeCloseTo(Math.PI / 8);
    expect(light.outerAngle).toBeCloseTo(Math.PI / 4);
  });

  it('honours every supplied option', () => {
    const light = new SpotLight2d({
      color: vec3.create(0.9, 0.5, 0.2),
      intensity: 3,
      range: 256,
      radius: 16,
      direction: vec2.create(0, -1),
      innerAngle: 0.2,
      outerAngle: 0.5,
    });
    expect(light.color[0]).toBeCloseTo(0.9);
    expect(light.intensity).toBe(3);
    expect(light.range).toBe(256);
    expect(light.radius).toBe(16);
    expect(light.direction[0]).toBe(0);
    expect(light.direction[1]).toBe(-1);
    expect(light.innerAngle).toBe(0.2);
    expect(light.outerAngle).toBe(0.5);
  });

  it('exposes the canonical visibility / transform requires set (mirrors PointLight2d)', () => {
    expect(SpotLight2d.requires).toEqual([
      Transform,
      GlobalTransform,
      Visibility,
      InheritedVisibility,
      ViewVisibility,
    ]);
  });
});
