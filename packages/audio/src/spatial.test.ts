import { describe, expect, it } from 'bun:test';

import { panForOffset } from './spatial';

describe('panForOffset', () => {
  it('is centered when the source is at the listener', () => {
    expect(panForOffset(5, 5, 10)).toBe(0);
  });

  it('pans right for a source to the listener’s right, left for the left', () => {
    expect(panForOffset(5, 0, 10)).toBe(0.5); // half a pan-width to the right
    expect(panForOffset(-5, 0, 10)).toBe(-0.5);
  });

  it('clamps to full left/right past the pan width', () => {
    expect(panForOffset(100, 0, 10)).toBe(1);
    expect(panForOffset(-100, 0, 10)).toBe(-1);
  });

  it('is relative to the listener position', () => {
    expect(panForOffset(30, 20, 10)).toBe(1); // 10 to the right = full
    expect(panForOffset(25, 20, 10)).toBe(0.5);
  });

  it('returns center for a non-positive pan width', () => {
    expect(panForOffset(5, 0, 0)).toBe(0);
  });
});
