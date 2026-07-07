import { describe, expect, it } from 'bun:test';

import { resolveTextureColorSpace, resolveTextureSampler } from './texture-import-settings';

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
