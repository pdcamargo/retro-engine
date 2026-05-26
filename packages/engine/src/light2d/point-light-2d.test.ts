import { describe, expect, it } from 'bun:test';

import { vec3 } from '@retro-engine/math';

import { GlobalTransform, Transform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

import { PointLight2d } from './point-light-2d';

describe('PointLight2d', () => {
  it('defaults color to (1, 1, 1), intensity 1, range 100, radius 0', () => {
    const light = new PointLight2d();
    expect(light.color[0]).toBe(1);
    expect(light.color[1]).toBe(1);
    expect(light.color[2]).toBe(1);
    expect(light.intensity).toBe(1);
    expect(light.range).toBe(100);
    expect(light.radius).toBe(0);
  });

  it('honours every supplied option', () => {
    const light = new PointLight2d({
      color: vec3.create(0.9, 0.5, 0.2),
      intensity: 3,
      range: 256,
      radius: 16,
    });
    expect(light.color[0]).toBeCloseTo(0.9);
    expect(light.color[1]).toBeCloseTo(0.5);
    expect(light.color[2]).toBeCloseTo(0.2);
    expect(light.intensity).toBe(3);
    expect(light.range).toBe(256);
    expect(light.radius).toBe(16);
  });

  it('exposes the canonical visibility / transform requires set (mirrors Sprite)', () => {
    // The chain is the same Required Components set as Sprite (ADR-0031),
    // so PointLight2d entities flow through the same visibility pipeline.
    expect(PointLight2d.requires).toEqual([
      Transform,
      GlobalTransform,
      Visibility,
      InheritedVisibility,
      ViewVisibility,
    ]);
  });

  it('exposes mutable fields so gameplay code can animate intensity / position / range at runtime', () => {
    const light = new PointLight2d();
    light.intensity = 2.5;
    light.range = 200;
    expect(light.intensity).toBe(2.5);
    expect(light.range).toBe(200);
  });
});
