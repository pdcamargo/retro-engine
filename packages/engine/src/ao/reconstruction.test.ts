import { mat4 } from '@retro-engine/math';
import type { Mat4 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import { jitterProjection } from '../camera/jitter';

/**
 * Guards the AO pass's core claim: reconstructing a view-space position from the
 * stored depth using the **jittered** inverse-projection (the matrix the depth
 * was rasterized with) recovers the original position exactly, jitter or not.
 * Mirrors the WGSL `reconstruct()` math in TypeScript so the invariant is
 * checked without a GPU.
 */

// Column-major mat4 * vec4.
const mul = (m: Float32Array, v: readonly [number, number, number, number]): [number, number, number, number] => {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    let acc = 0;
    for (let col = 0; col < 4; col++) acc += m[col * 4 + row]! * v[col]!;
    out[row] = acc;
  }
  return out;
};

// The TS twin of the WGSL reconstruct(): NDC.xy + stored depth + jittered
// inverse-projection → view-space position.
const reconstruct = (invProj: Float32Array, ndcX: number, ndcY: number, depth: number): [number, number, number] => {
  const v = mul(invProj, [ndcX, ndcY, depth, 1]);
  return [v[0] / v[3], v[1] / v[3], v[2] / v[3]];
};

describe('AO depth reconstruction under jitter', () => {
  const proj = mat4.perspective(1.0, 1.5, 0.1, 100) as Float32Array;
  const points: ReadonlyArray<[number, number, number]> = [
    [0.3, -0.2, -5],
    [-1.2, 0.8, -2.5],
    [0, 0, -0.5],
    [2.0, -1.5, -40],
  ];

  const roundTrip = (projection: Float32Array): void => {
    const inv = mat4.inverse(projection as unknown as Mat4) as unknown as Float32Array;
    for (const p of points) {
      // Forward: project the view-space point with the (possibly jittered)
      // projection, perspective-divide to NDC, take its depth.
      const clip = mul(projection, [p[0], p[1], p[2], 1]);
      const ndcX = clip[0] / clip[3];
      const ndcY = clip[1] / clip[3];
      const depth = clip[2] / clip[3];
      const rec = reconstruct(inv, ndcX, ndcY, depth);
      // Relative+absolute tolerance: reconstruction is exact up to float32 depth
      // precision, which loosens with distance from the camera.
      const tol = (c: number): number => 1e-3 * (1 + Math.abs(c));
      expect(Math.abs(rec[0] - p[0])).toBeLessThan(tol(p[0]));
      expect(Math.abs(rec[1] - p[1])).toBeLessThan(tol(p[1]));
      expect(Math.abs(rec[2] - p[2])).toBeLessThan(tol(p[2]));
    }
  };

  it('recovers the exact position from an unjittered projection', () => {
    roundTrip(proj);
  });

  it('recovers the exact position from a jittered projection (the trap ADR-0053 flagged)', () => {
    const jittered = mat4.create() as Mat4;
    jitterProjection(proj as unknown as Mat4, 0.0013, -0.0021, jittered);
    roundTrip(jittered as unknown as Float32Array);
  });

  it('a jittered inverse applied to unjittered NDC does NOT recover the point (why the matrix must match)', () => {
    // Sanity: reconstructing jittered depth with the *unjittered* inverse is the
    // shortcut we rejected — confirm it actually drifts, so the test above is
    // meaningful rather than tautological.
    const jittered = mat4.create() as Mat4;
    jitterProjection(proj as unknown as Mat4, 0.02, -0.02, jittered);
    const invUnjittered = mat4.inverse(proj as unknown as Mat4) as unknown as Float32Array;
    const p: [number, number, number] = [0.3, -0.2, -5];
    const clip = mul(jittered as unknown as Float32Array, [p[0], p[1], p[2], 1]);
    const rec = reconstruct(invUnjittered, clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]);
    const drift = Math.abs(rec[0] - p[0]) + Math.abs(rec[1] - p[1]);
    expect(drift).toBeGreaterThan(1e-3);
  });
});
