import { describe, expect, it } from 'bun:test';

import { haltonJitter, TAA_JITTER_SAMPLE_COUNT } from './halton';

describe('haltonJitter', () => {
  it('stays within a half-pixel of the sample center', () => {
    for (let f = 0; f < 64; f++) {
      const { x, y } = haltonJitter(f);
      expect(x).toBeGreaterThanOrEqual(-0.5);
      expect(x).toBeLessThanOrEqual(0.5);
      expect(y).toBeGreaterThanOrEqual(-0.5);
      expect(y).toBeLessThanOrEqual(0.5);
    }
  });

  it('repeats with the sample-window period', () => {
    const a = haltonJitter(3);
    const b = haltonJitter(3 + TAA_JITTER_SAMPLE_COUNT);
    expect(b.x).toBeCloseTo(a.x, 12);
    expect(b.y).toBeCloseTo(a.y, 12);
  });

  it('produces distinct offsets across the window (no degenerate lattice)', () => {
    const seen = new Set<string>();
    for (let f = 0; f < TAA_JITTER_SAMPLE_COUNT; f++) {
      const { x, y } = haltonJitter(f);
      seen.add(`${x.toFixed(6)},${y.toFixed(6)}`);
    }
    expect(seen.size).toBe(TAA_JITTER_SAMPLE_COUNT);
  });

  it('handles negative frame indices without escaping range', () => {
    const { x, y } = haltonJitter(-1);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    expect(x).toBeGreaterThanOrEqual(-0.5);
    expect(x).toBeLessThanOrEqual(0.5);
  });
});
