import { describe, expect, it } from 'bun:test';
import { mat4 } from '@retro-engine/math';

import {
  VIEW_UNIFORM_BYTE_SIZE,
  VIEW_UNIFORM_FLOAT_COUNT,
  VIEW_UNIFORM_WGSL,
} from './extracted';
import { jitterProjection } from './jitter';

// Column-major perspective matrix (element = column * 4 + row). Its fourth row
// is (0, 0, -1, 0), so `clip.w = -z_view` — the entries jitter must perturb sit
// in column 2 (indices 8, 9).
const perspective = (): Float32Array =>
  new Float32Array([
    1.5, 0, 0, 0, // col 0
    0, 2.0, 0, 0, // col 1
    0, 0, -1.002, -1, // col 2
    0, 0, -0.2, 0, // col 3
  ]);

// Column-major orthographic matrix. Its fourth row is (0, 0, 0, 1) — `clip.w = 1`
// — so jitter must instead perturb the translation column (indices 12, 13).
const orthographic = (): Float32Array =>
  new Float32Array([
    0.1, 0, 0, 0, // col 0
    0, 0.2, 0, 0, // col 1
    0, 0, -0.01, 0, // col 2
    -1, -1, 0, 1, // col 3
  ]);

describe('jitterProjection', () => {
  it('shifts only clip.x/clip.y via the w-contributing column (perspective)', () => {
    const src = perspective();
    const out = mat4.create();
    jitterProjection(src, 0.25, -0.5, out);

    // Only column 2's x/y rows change: out[8] += jx * w(=-1), out[9] += jy * w.
    expect(out[8]).toBeCloseTo(0 + 0.25 * -1, 6);
    expect(out[9]).toBeCloseTo(0 + -0.5 * -1, 6);

    // Every other element is copied verbatim.
    for (let i = 0; i < 16; i++) {
      if (i === 8 || i === 9) continue;
      expect(out[i]).toBe(src[i]!);
    }
  });

  it('shifts the translation column for an orthographic projection', () => {
    const src = orthographic();
    const out = mat4.create();
    jitterProjection(src, 0.25, -0.5, out);

    // w = 1 lives in column 3, so the offset lands on indices 12/13.
    expect(out[12]).toBeCloseTo(-1 + 0.25 * 1, 6);
    expect(out[13]).toBeCloseTo(-1 + -0.5 * 1, 6);
    for (let i = 0; i < 16; i++) {
      if (i === 12 || i === 13) continue;
      expect(out[i]).toBe(src[i]!);
    }
  });

  it('is a no-op for a zero offset', () => {
    const src = perspective();
    const out = mat4.create();
    jitterProjection(src, 0, 0, out);
    for (let i = 0; i < 16; i++) expect(out[i]).toBe(src[i]!);
  });

  it('does not mutate the source matrix', () => {
    const src = perspective();
    const copy = new Float32Array(src);
    jitterProjection(src, 0.3, 0.4, mat4.create());
    expect(Array.from(src)).toEqual(Array.from(copy));
  });
});

describe('view uniform layout', () => {
  it('reserves room for the appended unjittered_view_proj matrix', () => {
    // 416 = 352 (prev layout) + 64 (one mat4x4<f32>). A buffer sized to the old
    // 352 bound against the larger struct is a device-fatal validation error
    // the permissive test stub cannot catch — this guards the constant.
    expect(VIEW_UNIFORM_BYTE_SIZE).toBe(416);
    expect(VIEW_UNIFORM_FLOAT_COUNT).toBe(104);
  });

  it('declares unjittered_view_proj in the shared WGSL struct', () => {
    expect(VIEW_UNIFORM_WGSL).toContain('unjittered_view_proj: mat4x4<f32>');
  });
});
