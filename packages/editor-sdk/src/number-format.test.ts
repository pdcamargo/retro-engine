import { describe, expect, it } from 'bun:test';

import { adaptiveDecimals } from './number-format';

// A value rendered with `d` decimals reads as zero when toFixed(d) is "0", "0.0", …
const rendersZero = (v: number, d: number): boolean => Number(v.toFixed(d)) === 0;

describe('adaptiveDecimals', () => {
  it('keeps base precision for zero and magnitudes >= 1', () => {
    expect(adaptiveDecimals(0, 0.1)).toBe(1);
    expect(adaptiveDecimals(26.7, 0.1)).toBe(1);
    expect(adaptiveDecimals(1, 0.1)).toBe(1);
    expect(adaptiveDecimals(-3.5, 0.1)).toBe(1);
    expect(adaptiveDecimals(5, undefined)).toBe(0); // integer step
  });

  it('never renders a small non-zero magnitude as 0 (the cm→m scale trap)', () => {
    for (const v of [0.01, -0.01, 0.05, 0.0099, 0.001, 0.15, 0.5, 0.9]) {
      expect(rendersZero(v, adaptiveDecimals(v, 0.1))).toBe(false);
    }
  });

  it('caps at 6 decimals for very small values', () => {
    expect(adaptiveDecimals(1e-9, 0.1)).toBe(6);
  });

  it('honors a larger base when the step is tiny', () => {
    expect(adaptiveDecimals(0.5, 0.001)).toBeGreaterThanOrEqual(2);
  });
});
