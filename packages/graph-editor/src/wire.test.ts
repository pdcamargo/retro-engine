import { describe, expect, it } from 'bun:test';

import type { Point } from './document';
import { wireDistance, wireTangent } from './wire';

describe('wire', () => {
  it('clamps the tangent handle length', () => {
    expect(wireTangent(0, 4, 1)).toBe(26); // |dx|*0.5 = 2 -> clamped up to 26
    expect(wireTangent(0, 100, 1)).toBe(50); // 50 within [26,150]
    expect(wireTangent(0, 1000, 1)).toBe(150); // clamped down to 150
    expect(wireTangent(0, 100, 2)).toBe(52); // clamp bounds scale with zoom
  });

  it('reports ~0 distance on the wire endpoints and large off it', () => {
    const pts: Point[] = [
      [0, 0],
      [400, 0],
    ];
    expect(wireDistance(pts, 0, 0, 1)).toBeLessThan(2);
    expect(wireDistance(pts, 400, 0, 1)).toBeLessThan(2);
    expect(wireDistance(pts, 200, 200, 1)).toBeGreaterThan(50);
  });

  it('bends toward a reroute knot (closer to the knot than a straight line)', () => {
    const straight: Point[] = [
      [0, 0],
      [400, 0],
    ];
    const bent: Point[] = [
      [0, 0],
      [200, 120],
      [400, 0],
    ];
    // A point near the knot is far from the straight wire but near the bent one.
    expect(wireDistance(straight, 200, 120, 1)).toBeGreaterThan(80);
    expect(wireDistance(bent, 200, 120, 1)).toBeLessThan(40);
  });
});
