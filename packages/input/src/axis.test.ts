import { describe, expect, it } from 'bun:test';

import { Axis } from './axis';

describe('Axis', () => {
  it('stores and reads a value', () => {
    const axis = new Axis<string>();
    axis.set('LeftStickX', 0.5);
    expect(axis.get('LeftStickX')).toBe(0.5);
  });

  it('clamps to the default [-1, 1] range', () => {
    const axis = new Axis<string>();
    axis.set('x', 5);
    axis.set('y', -5);
    expect(axis.get('x')).toBe(1);
    expect(axis.get('y')).toBe(-1);
  });

  it('clamps to a custom range', () => {
    const axis = new Axis<string>(0, 255);
    axis.set('trigger', 300);
    axis.set('trigger2', -10);
    expect(axis.get('trigger')).toBe(255);
    expect(axis.get('trigger2')).toBe(0);
  });

  it('get returns undefined for an unset axis, getOrZero returns 0', () => {
    const axis = new Axis<string>();
    expect(axis.get('missing')).toBeUndefined();
    expect(axis.getOrZero('missing')).toBe(0);
  });

  it('remove deletes an axis', () => {
    const axis = new Axis<string>();
    axis.set('x', 0.3);
    expect(axis.remove('x')).toBe(true);
    expect(axis.get('x')).toBeUndefined();
    expect(axis.remove('x')).toBe(false);
  });

  it('getAll enumerates set axes', () => {
    const axis = new Axis<string>();
    axis.set('a', 0.1);
    axis.set('b', 0.2);
    expect([...axis.getAll()].sort()).toEqual(['a', 'b']);
  });
});
