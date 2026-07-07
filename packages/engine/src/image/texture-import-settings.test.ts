import { describe, expect, it } from 'bun:test';

import {
  parseTextureMeta,
  resolveTextureColorSpace,
  resolveTextureSampler,
  textureMetaSibling,
} from './texture-import-settings';

const meta = (obj: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(obj));

describe('resolveTextureSampler', () => {
  it('defaults to linear filtering, clamped wrap', () => {
    const s = resolveTextureSampler();
    expect(s.magFilter).toBe('linear');
    expect(s.minFilter).toBe('linear');
    expect(s.addressModeU).toBe('clamp-to-edge');
    expect(s.addressModeV).toBe('clamp-to-edge');
  });

  it('maps nearest filtering (pixel-art)', () => {
    const s = resolveTextureSampler({ filter: 'nearest' });
    expect(s.magFilter).toBe('nearest');
    expect(s.minFilter).toBe('nearest');
  });

  it('maps each wrap mode to its address mode on both axes', () => {
    expect(resolveTextureSampler({ wrap: 'repeat' }).addressModeU).toBe('repeat');
    expect(resolveTextureSampler({ wrap: 'mirror' }).addressModeU).toBe('mirror-repeat');
    expect(resolveTextureSampler({ wrap: 'clamp' }).addressModeV).toBe('clamp-to-edge');
  });
});

describe('resolveTextureColorSpace', () => {
  it('defaults to srgb (base color)', () => {
    expect(resolveTextureColorSpace()).toBe('srgb');
  });

  it('honors an explicit linear color space (data maps)', () => {
    expect(resolveTextureColorSpace({ colorSpace: 'linear' })).toBe('linear');
  });
});

describe('parseTextureMeta', () => {
  it('parses recognized fields', () => {
    expect(parseTextureMeta(meta({ filter: 'nearest', wrap: 'repeat', colorSpace: 'linear' }))).toEqual({
      filter: 'nearest',
      wrap: 'repeat',
      colorSpace: 'linear',
    });
  });

  it('drops unknown / invalid fields rather than throwing (partial meta stays usable)', () => {
    expect(parseTextureMeta(meta({ filter: 'sparkly', wrap: 'repeat', extra: 1 }))).toEqual({
      wrap: 'repeat',
    });
  });

  it('returns empty for a non-object payload', () => {
    expect(parseTextureMeta(meta(42))).toEqual({});
    expect(parseTextureMeta(meta(null))).toEqual({});
  });

  it('throws only on non-JSON bytes', () => {
    expect(() => parseTextureMeta(new TextEncoder().encode('{not json'))).toThrow();
  });
});

describe('textureMetaSibling', () => {
  it('is the basename + .meta, relative to the asset dir', () => {
    expect(textureMetaSibling('textures/wood.png')).toBe('wood.png.meta');
    expect(textureMetaSibling('hero.png')).toBe('hero.png.meta');
  });
});
