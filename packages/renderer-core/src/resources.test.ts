import { describe, expect, it } from 'bun:test';

import { BufferUsage, TextureUsage } from './resources';
import type {
  BufferDescriptor,
  BufferUsageFlags,
  SamplerDescriptor,
  TextureDescriptor,
  TextureUsageFlags,
} from './resources';

describe('BufferUsage', () => {
  it('exposes the expected flag bits', () => {
    expect(BufferUsage.MAP_READ).toBe(0x0001);
    expect(BufferUsage.MAP_WRITE).toBe(0x0002);
    expect(BufferUsage.COPY_SRC).toBe(0x0004);
    expect(BufferUsage.COPY_DST).toBe(0x0008);
    expect(BufferUsage.INDEX).toBe(0x0010);
    expect(BufferUsage.VERTEX).toBe(0x0020);
    expect(BufferUsage.UNIFORM).toBe(0x0040);
    expect(BufferUsage.STORAGE).toBe(0x0080);
    expect(BufferUsage.INDIRECT).toBe(0x0100);
    expect(BufferUsage.QUERY_RESOLVE).toBe(0x0200);
  });

  it('combines via bitwise OR', () => {
    const combined: BufferUsageFlags = BufferUsage.UNIFORM | BufferUsage.COPY_DST;
    expect(combined & BufferUsage.UNIFORM).not.toBe(0);
    expect(combined & BufferUsage.COPY_DST).not.toBe(0);
    expect(combined & BufferUsage.VERTEX).toBe(0);
  });
});

describe('TextureUsage', () => {
  it('exposes the expected flag bits', () => {
    expect(TextureUsage.COPY_SRC).toBe(0x01);
    expect(TextureUsage.COPY_DST).toBe(0x02);
    expect(TextureUsage.TEXTURE_BINDING).toBe(0x04);
    expect(TextureUsage.STORAGE_BINDING).toBe(0x08);
    expect(TextureUsage.RENDER_ATTACHMENT).toBe(0x10);
  });

  it('combines via bitwise OR', () => {
    const combined: TextureUsageFlags = TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST;
    expect(combined & TextureUsage.TEXTURE_BINDING).not.toBe(0);
    expect(combined & TextureUsage.COPY_DST).not.toBe(0);
    expect(combined & TextureUsage.RENDER_ATTACHMENT).toBe(0);
  });
});

describe('Descriptor structural shapes', () => {
  it('BufferDescriptor accepts size + usage + label', () => {
    const desc: BufferDescriptor = {
      size: 1024,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
      label: 'camera-uniforms',
    };
    expect(desc.size).toBe(1024);
  });

  it('TextureDescriptor accepts the documented fields', () => {
    const desc: TextureDescriptor = {
      width: 256,
      height: 256,
      format: 'rgba8unorm',
      usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
      mipLevelCount: 1,
      sampleCount: 1,
    };
    expect(desc.width).toBe(256);
    expect(desc.format).toBe('rgba8unorm');
  });

  it('SamplerDescriptor is fully optional', () => {
    const empty: SamplerDescriptor = {};
    expect(empty.magFilter).toBeUndefined();
    const filled: SamplerDescriptor = {
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
    };
    expect(filled.magFilter).toBe('linear');
  });
});
