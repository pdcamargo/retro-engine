import { describe, expect, it } from 'bun:test';

import { vec3 } from '@retro-engine/math';

import { GlobalTransform, Transform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

import { AmbientLight } from './ambient-light';
import { DirectionalLight3d } from './directional-light-3d';
import { PointLight3d } from './point-light-3d';
import { SpotLight3d } from './spot-light-3d';

const VISIBILITY_REQUIRES = [
  Transform,
  GlobalTransform,
  Visibility,
  InheritedVisibility,
  ViewVisibility,
];

describe('PointLight3d', () => {
  it('defaults to white, intensity 1, range 20, radius 0', () => {
    const light = new PointLight3d();
    expect(Array.from(light.color)).toEqual([1, 1, 1]);
    expect(light.intensity).toBe(1);
    expect(light.range).toBe(20);
    expect(light.radius).toBe(0);
  });

  it('honours supplied options', () => {
    const light = new PointLight3d({ color: vec3.create(0.5, 0.6, 0.7), intensity: 8, range: 30, radius: 2 });
    expect(light.color[0]).toBeCloseTo(0.5);
    expect(light.color[1]).toBeCloseTo(0.6);
    expect(light.color[2]).toBeCloseTo(0.7);
    expect(light.intensity).toBe(8);
    expect(light.range).toBe(30);
    expect(light.radius).toBe(2);
  });

  it('requires the visibility + transform chain', () => {
    expect(PointLight3d.requires).toEqual(VISIBILITY_REQUIRES);
  });
});

describe('SpotLight3d', () => {
  it('defaults to white, intensity 1, range 20, cone π/8..π/4, and no direction field', () => {
    const light = new SpotLight3d();
    expect(Array.from(light.color)).toEqual([1, 1, 1]);
    expect(light.intensity).toBe(1);
    expect(light.range).toBe(20);
    expect(light.radius).toBe(0);
    expect(light.innerAngle).toBeCloseTo(Math.PI / 8);
    expect(light.outerAngle).toBeCloseTo(Math.PI / 4);
    // Direction is derived from GlobalTransform, not stored on the component.
    expect('direction' in light).toBe(false);
  });

  it('honours supplied cone angles', () => {
    const light = new SpotLight3d({ innerAngle: 0.2, outerAngle: 0.5 });
    expect(light.innerAngle).toBe(0.2);
    expect(light.outerAngle).toBe(0.5);
  });

  it('requires the visibility + transform chain', () => {
    expect(SpotLight3d.requires).toEqual(VISIBILITY_REQUIRES);
  });
});

describe('DirectionalLight3d', () => {
  it('defaults to white, intensity 1, and has no position/direction fields', () => {
    const light = new DirectionalLight3d();
    expect(Array.from(light.color)).toEqual([1, 1, 1]);
    expect(light.intensity).toBe(1);
    expect('direction' in light).toBe(false);
  });

  it('requires the visibility + transform chain (position ignored, direction from transform)', () => {
    expect(DirectionalLight3d.requires).toEqual(VISIBILITY_REQUIRES);
  });
});

describe('AmbientLight (resource)', () => {
  it('defaults to white at a dim brightness floor', () => {
    const ambient = new AmbientLight();
    expect(Array.from(ambient.color)).toEqual([1, 1, 1]);
    expect(ambient.brightness).toBe(0.05);
  });

  it('honours supplied colour + brightness', () => {
    const ambient = new AmbientLight({ color: vec3.create(0.6, 0.7, 1), brightness: 0.2 });
    expect(ambient.color[0]).toBeCloseTo(0.6);
    expect(ambient.color[1]).toBeCloseTo(0.7);
    expect(ambient.color[2]).toBeCloseTo(1);
    expect(ambient.brightness).toBe(0.2);
  });

  it('is a plain resource, not an ECS component (no requires)', () => {
    expect((AmbientLight as unknown as { requires?: unknown }).requires).toBeUndefined();
  });
});
