import { describe, expect, it } from 'bun:test';

import { color, Colors } from './index';

describe('color', () => {
  it('creates a color with default alpha 1', () => {
    expect(color(0.5, 0.5, 0.5)).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
  });

  it('respects an explicit alpha', () => {
    expect(color(1, 0, 0, 0.5).a).toBe(0.5);
  });

  it('exposes named colors', () => {
    expect(Colors.white.r).toBe(1);
    expect(Colors.transparent.a).toBe(0);
  });
});
