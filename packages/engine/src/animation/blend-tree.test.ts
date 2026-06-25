import { describe, expect, it } from 'bun:test';

import { weights1d, weights2d } from './blend-tree';

const sum = (a: Float32Array, n: number): number => {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]!;
  return s;
};

describe('weights1d', () => {
  it('holds the endpoints outside the threshold range', () => {
    const out = new Float32Array(2);
    weights1d([0, 1], -5, out);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(0);
    weights1d([0, 1], 5, out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
  });

  it('linearly interpolates between the bracketing thresholds', () => {
    const out = new Float32Array(3);
    weights1d([0, 1, 2], 0.25, out);
    expect(out[0]).toBeCloseTo(0.75, 5);
    expect(out[1]).toBeCloseTo(0.25, 5);
    expect(out[2]).toBe(0);
    expect(sum(out, 3)).toBeCloseTo(1, 5);
  });
});

describe('weights2d', () => {
  // 4 directional points (E, N, W, S) plus a center.
  const positions = new Float32Array([1, 0, 0, 1, -1, 0, 0, -1, 0, 0]);
  const N = 5;

  for (const mode of ['freeformCartesian', 'freeformDirectional', 'simpleDirectional'] as const) {
    it(`${mode}: weights sum to 1 and a sample on a point favors it`, () => {
      const out = new Float32Array(N);
      // Exactly on the East point.
      weights2d(mode, positions, N, 1, 0, out);
      expect(sum(out, N)).toBeCloseTo(1, 4);
      expect(out[0]).toBeGreaterThan(0.5);
    });

    it(`${mode}: a centered sample favors the center motion`, () => {
      const out = new Float32Array(N);
      weights2d(mode, positions, N, 0, 0, out);
      expect(sum(out, N)).toBeCloseTo(1, 4);
      expect(out[4]).toBeGreaterThan(0.4);
    });
  }

  it('freeformCartesian blends two neighbors for an in-between sample', () => {
    const out = new Float32Array(N);
    // Between East and North, off-center.
    weights2d('freeformCartesian', positions, N, 0.5, 0.5, out);
    expect(sum(out, N)).toBeCloseTo(1, 4);
    expect(out[0]).toBeGreaterThan(0); // East
    expect(out[1]).toBeGreaterThan(0); // North
  });
});
