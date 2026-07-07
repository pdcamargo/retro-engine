import { describe, expect, it } from 'bun:test';

import { attenuationForDistance, panForOffset } from './spatial';

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

describe('attenuationForDistance', () => {
  it('is full volume within the reference distance', () => {
    expect(attenuationForDistance(0, 1, 100, 1)).toBe(1);
    expect(attenuationForDistance(1, 1, 100, 1)).toBe(1);
    expect(attenuationForDistance(0.5, 1, 100, 1)).toBe(1); // clamped up to ref
  });

  it('fades linearly between ref and max, reaching silence at max with rolloff 1', () => {
    // linear model: 1 - rolloff * (d - ref) / (max - ref); ref=0, max=10, rolloff=1.
    expect(attenuationForDistance(5, 0, 10, 1)).toBeCloseTo(0.5, 10);
    expect(attenuationForDistance(10, 0, 10, 1)).toBe(0);
    expect(attenuationForDistance(2.5, 0, 10, 1)).toBeCloseTo(0.75, 10);
  });

  it('does not fade further past the max distance', () => {
    expect(attenuationForDistance(1000, 0, 10, 1)).toBe(0);
    // rolloff 0.5 → floor of 0.5 at and beyond max.
    expect(attenuationForDistance(10, 0, 10, 0.5)).toBeCloseTo(0.5, 10);
    expect(attenuationForDistance(999, 0, 10, 0.5)).toBeCloseTo(0.5, 10);
  });

  it('disables attenuation for a non-positive rolloff (pan-only spatial source)', () => {
    expect(attenuationForDistance(50, 1, 100, 0)).toBe(1);
    expect(attenuationForDistance(50, 1, 100, -1)).toBe(1);
  });

  it('treats a degenerate range (max <= ref) as no attenuation', () => {
    expect(attenuationForDistance(50, 10, 10, 1)).toBe(1);
    expect(attenuationForDistance(50, 10, 5, 1)).toBe(1);
  });

  it('clamps the result to [0, 1] for an over-steep rolloff', () => {
    expect(attenuationForDistance(5, 0, 10, 4)).toBe(0); // 1 - 4*0.5 = -1 → 0
  });
});
