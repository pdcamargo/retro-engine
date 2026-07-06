import { describe, expect, it } from 'bun:test';

import { packUiColor, packUiQuad, UI_INSTANCE_FLOAT_COUNT } from './ui-instance';
import { computeClipRect } from './ui-prepare';

describe('computeClipRect', () => {
  it('maps a full-viewport box to the whole clip range', () => {
    const r = computeClipRect(0, 0, 800, 600, 800, 600);
    expect([r.left, r.top, r.right, r.bottom]).toEqual([-1, 1, 1, -1]);
  });

  it('maps a centered quarter-size box symmetrically', () => {
    // A 400×300 box centered in an 800×600 viewport → clip [-0.5, 0.5] each axis.
    const r = computeClipRect(200, 150, 400, 300, 800, 600);
    expect(r.left).toBeCloseTo(-0.5, 6);
    expect(r.right).toBeCloseTo(0.5, 6);
    expect(r.top).toBeCloseTo(0.5, 6);
    expect(r.bottom).toBeCloseTo(-0.5, 6);
  });

  it('keeps y-down screen space → y-up clip (top has the larger clip y)', () => {
    const r = computeClipRect(0, 0, 100, 100, 1000, 1000);
    expect(r.top).toBeGreaterThan(r.bottom);
  });
});

describe('packUiColor', () => {
  it('packs opaque red as little-endian RGBA', () => {
    expect(packUiColor(1, 0, 0, 1)).toBe(0xff0000ff >>> 0);
  });

  it('packs opaque blue', () => {
    expect(packUiColor(0, 0, 1, 1)).toBe(0xffff0000 >>> 0);
  });

  it('clamps out-of-range channels', () => {
    expect(packUiColor(2, -1, 0.5, 1)).toBe(packUiColor(1, 0, 0.5, 1));
  });
});

describe('packUiQuad', () => {
  it('writes four rect floats then one packed color at the cursor', () => {
    const buffer = new ArrayBuffer(2 * UI_INSTANCE_FLOAT_COUNT * 4);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    const color = packUiColor(0, 1, 0, 1);

    packUiQuad(-1, 1, 1, -1, color, f32, u32, UI_INSTANCE_FLOAT_COUNT); // second slot

    expect(f32[5]).toBe(-1);
    expect(f32[6]).toBe(1);
    expect(f32[7]).toBe(1);
    expect(f32[8]).toBe(-1);
    expect(u32[9]).toBe(color);
    // First slot untouched.
    expect(f32[0]).toBe(0);
  });
});
