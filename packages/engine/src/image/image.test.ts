import { describe, expect, it } from 'bun:test';

import { vec4 } from '@retro-engine/math';

import { bytesPerTexel, Image } from './image';
import { Images } from './images';

describe('Image.solid', () => {
  it('packs an opaque white pixel as four 0xFF bytes', () => {
    const img = Image.solid(vec4.create(1, 1, 1, 1));
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
    expect(img.depthOrArrayLayers).toBe(1);
    expect(img.dimension).toBe('2d');
    expect(img.format).toBe('rgba8unorm');
    expect(img.mipLevelCount).toBe(1);
    expect(img.data.byteLength).toBe(4);
    expect(Array.from(img.data)).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  it('packs a flat normal as 0x80, 0x80, 0xFF, 0xFF', () => {
    const img = Image.solid(vec4.create(0.5, 0.5, 1, 1));
    // 0.5 * 255 = 127.5 → rounds to 128 (0x80).
    expect(Array.from(img.data)).toEqual([0x80, 0x80, 0xff, 0xff]);
  });

  it('clamps out-of-range components', () => {
    const img = Image.solid(vec4.create(-1, 0, 1, 2));
    expect(Array.from(img.data)).toEqual([0x00, 0x00, 0xff, 0xff]);
  });

  it('defaults to a linear-linear sampler', () => {
    const img = Image.solid(vec4.create(1, 1, 1, 1));
    expect(img.sampler.magFilter).toBe('linear');
    expect(img.sampler.minFilter).toBe('linear');
  });

  it('accepts a custom sampler via opts', () => {
    const img = Image.solid(vec4.create(0, 0, 0, 1), {
      sampler: { magFilter: 'nearest', minFilter: 'nearest' },
    });
    expect(img.sampler.magFilter).toBe('nearest');
    expect(img.sampler.minFilter).toBe('nearest');
  });

  it("defaults colorSpace to 'srgb'", () => {
    const img = Image.solid(vec4.create(1, 0.5, 0.25, 1));
    expect(img.colorSpace).toBe('srgb');
  });

  it("propagates colorSpace: 'linear'", () => {
    const img = Image.solid(vec4.create(0.5, 0.5, 1, 1), { colorSpace: 'linear' });
    expect(img.colorSpace).toBe('linear');
  });
});

describe('Image.checker', () => {
  it('produces a size×size buffer with alternating texels', () => {
    const a = vec4.create(1, 1, 1, 1);
    const b = vec4.create(0, 0, 0, 1);
    const img = Image.checker(2, a, b);
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(img.format).toBe('rgba8unorm');
    expect(img.data.byteLength).toBe(2 * 2 * 4);
    // (0,0) → A, (1,0) → B, (0,1) → B, (1,1) → A
    expect(Array.from(img.data.slice(0, 4))).toEqual([0xff, 0xff, 0xff, 0xff]);
    expect(Array.from(img.data.slice(4, 8))).toEqual([0x00, 0x00, 0x00, 0xff]);
    expect(Array.from(img.data.slice(8, 12))).toEqual([0x00, 0x00, 0x00, 0xff]);
    expect(Array.from(img.data.slice(12, 16))).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  it('defaults to a nearest-nearest sampler so checks stay crisp', () => {
    const img = Image.checker(2, vec4.create(1, 0, 0, 1), vec4.create(0, 1, 0, 1));
    expect(img.sampler.magFilter).toBe('nearest');
    expect(img.sampler.minFilter).toBe('nearest');
  });

  it('throws on non-positive sizes', () => {
    expect(() => Image.checker(0, vec4.create(1, 1, 1, 1), vec4.create(0, 0, 0, 1))).toThrow(
      /positive integer/,
    );
    expect(() => Image.checker(-1, vec4.create(1, 1, 1, 1), vec4.create(0, 0, 0, 1))).toThrow(
      /positive integer/,
    );
    expect(() => Image.checker(1.5, vec4.create(1, 1, 1, 1), vec4.create(0, 0, 0, 1))).toThrow(
      /positive integer/,
    );
  });

  it("defaults colorSpace to 'srgb' and propagates an explicit override", () => {
    const a = vec4.create(1, 1, 1, 1);
    const b = vec4.create(0, 0, 0, 1);
    expect(Image.checker(2, a, b).colorSpace).toBe('srgb');
    expect(Image.checker(2, a, b, { colorSpace: 'linear' }).colorSpace).toBe('linear');
  });
});

describe('Image.fromBytes', () => {
  it('round-trips a manually constructed RGBA8 buffer', () => {
    const data = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
    const img = Image.fromBytes({
      data,
      format: 'rgba8unorm',
      width: 2,
      height: 1,
      label: 'manual',
    });
    expect(img.width).toBe(2);
    expect(img.height).toBe(1);
    expect(img.label).toBe('manual');
    expect(img.data).toBe(data); // no copy
  });

  it('rejects a mismatched byte length', () => {
    const data = new Uint8Array(7);
    expect(() =>
      Image.fromBytes({
        data,
        format: 'rgba8unorm',
        width: 2,
        height: 1,
      }),
    ).toThrow(/byteLength 7 does not match/);
  });

  it('rejects depth formats', () => {
    expect(() =>
      Image.fromBytes({
        data: new Uint8Array(16),
        format: 'depth32float',
        width: 2,
        height: 2,
      }),
    ).toThrow(/sampled colour format/);
  });

  it('rejects explicit -srgb formats (route them through colorSpace)', () => {
    expect(() =>
      Image.fromBytes({
        data: new Uint8Array(4),
        format: 'rgba8unorm-srgb',
        width: 1,
        height: 1,
      }),
    ).toThrow(/pass a base format/);
  });

  it('rejects cube images without six layers', () => {
    expect(() =>
      Image.fromBytes({
        data: new Uint8Array(4),
        format: 'rgba8unorm',
        width: 1,
        height: 1,
        dimension: 'cube',
        depthOrArrayLayers: 1,
      }),
    ).toThrow(/cube images require depthOrArrayLayers=6/);
  });

  it('accepts a 1×1 cube image with six layers', () => {
    const img = Image.fromBytes({
      data: new Uint8Array(24),
      format: 'rgba8unorm',
      width: 1,
      height: 1,
      dimension: 'cube',
      depthOrArrayLayers: 6,
    });
    expect(img.dimension).toBe('cube');
    expect(img.depthOrArrayLayers).toBe(6);
  });

  it("defaults colorSpace to 'srgb' and propagates an explicit override", () => {
    const defaulted = Image.fromBytes({
      data: new Uint8Array(4),
      format: 'rgba8unorm',
      width: 1,
      height: 1,
    });
    expect(defaulted.colorSpace).toBe('srgb');
    const explicit = Image.fromBytes({
      data: new Uint8Array(4),
      format: 'rgba8unorm',
      width: 1,
      height: 1,
      colorSpace: 'linear',
    });
    expect(explicit.colorSpace).toBe('linear');
  });
});

describe('Image default registry handles', () => {
  // These three handles are load-bearing for StandardMaterial / sprite
  // fallbacks. Regression guards: WHITE/BLACK rely on 0.0/1.0 being invariant
  // under sRGB ↔ linear so they can fall back into both color and data slots;
  // NORMAL_FLAT must stay linear so 0.5 doesn't decode to ~0.214.
  it('seeds WHITE / BLACK as srgb and NORMAL_FLAT as linear', () => {
    const images = new Images();
    expect(images.get(images.WHITE)?.colorSpace).toBe('srgb');
    expect(images.get(images.BLACK)?.colorSpace).toBe('srgb');
    expect(images.get(images.NORMAL_FLAT)?.colorSpace).toBe('linear');
  });
});

describe('bytesPerTexel', () => {
  it('reports the texel size for sampled formats', () => {
    expect(bytesPerTexel('rgba8unorm')).toBe(4);
    expect(bytesPerTexel('rgba8unorm-srgb')).toBe(4);
    expect(bytesPerTexel('bgra8unorm')).toBe(4);
    expect(bytesPerTexel('bgra8unorm-srgb')).toBe(4);
    expect(bytesPerTexel('rgba16float')).toBe(8);
  });

  it('returns undefined for depth formats', () => {
    expect(bytesPerTexel('depth32float')).toBeUndefined();
    expect(bytesPerTexel('depth24plus')).toBeUndefined();
    expect(bytesPerTexel('depth24plus-stencil8')).toBeUndefined();
  });
});
