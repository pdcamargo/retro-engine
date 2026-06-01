import { Assets, type Image } from '@retro-engine/engine';
import type { SamplerDescriptor } from '@retro-engine/renderer-core';
import { describe, expect, it } from 'bun:test';

import { createImageResolver } from './image-mapping';
import { fakeLoadContext, rawBytes, stubDecoder } from './mapping-test-support';
import type { GltfDocument } from './schema';
import { expectGltfErrorAsync } from './test-support';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const linearSampler: SamplerDescriptor = {
  addressModeU: 'repeat',
  addressModeV: 'repeat',
  magFilter: 'linear',
  minFilter: 'linear',
  mipmapFilter: 'linear',
};
const nearestSampler: SamplerDescriptor = { ...linearSampler, magFilter: 'nearest' };

describe('createImageResolver — dedup', () => {
  it('mints one handle per (source, color space, sampler) and dedups repeats', async () => {
    const document: GltfDocument = { asset: { version: '2.0' }, images: [{ uri: 'a.png' }] };
    const images = new Assets<Image>();
    const { ctx, labels } = fakeLoadContext({ 'a.png': PNG });
    const resolver = createImageResolver(document, [], ctx, images, stubDecoder);

    const h1 = await resolver.resolve(0, 'srgb', linearSampler);
    const h2 = await resolver.resolve(0, 'srgb', linearSampler);

    expect(h2.index).toBe(h1.index);
    expect(images.size).toBe(1);
    expect(resolver.handles).toHaveLength(1);
    expect(labels).toEqual(['Image0']);
  });

  it('duplicates the image on sampler divergence', async () => {
    const document: GltfDocument = { asset: { version: '2.0' }, images: [{ uri: 'a.png' }] };
    const images = new Assets<Image>();
    const { ctx } = fakeLoadContext({ 'a.png': PNG });
    const resolver = createImageResolver(document, [], ctx, images, stubDecoder);

    const h1 = await resolver.resolve(0, 'srgb', linearSampler);
    const h2 = await resolver.resolve(0, 'srgb', nearestSampler);

    expect(h2.index).not.toBe(h1.index);
    expect(images.size).toBe(2);
  });

  it('duplicates the image on color-space divergence', async () => {
    const document: GltfDocument = { asset: { version: '2.0' }, images: [{ uri: 'a.png' }] };
    const images = new Assets<Image>();
    const { ctx } = fakeLoadContext({ 'a.png': PNG });
    const resolver = createImageResolver(document, [], ctx, images, stubDecoder);

    const srgb = await resolver.resolve(0, 'srgb', linearSampler);
    const linear = await resolver.resolve(0, 'linear', linearSampler);

    expect(linear.index).not.toBe(srgb.index);
    expect(images.get(srgb)!.colorSpace).toBe('srgb');
    expect(images.get(linear)!.colorSpace).toBe('linear');
  });
});

describe('createImageResolver — sources', () => {
  it('resolves an image from a bufferView source', async () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      images: [{ bufferView: 0 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: PNG.byteLength }],
    };
    const images = new Assets<Image>();
    const { ctx } = fakeLoadContext();
    const resolver = createImageResolver(document, [rawBytes(PNG)], ctx, images, stubDecoder);

    const handle = await resolver.resolve(0, 'srgb', linearSampler);
    expect(images.get(handle)!.sampler).toEqual(linearSampler);
  });

  it('rejects a KTX2 image (decode deferred)', async () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      images: [{ uri: 'a.ktx2', mimeType: 'image/ktx2' }],
    };
    const images = new Assets<Image>();
    const { ctx } = fakeLoadContext({ 'a.ktx2': new Uint8Array([0xab, 0x4b, 0x54, 0x58]) });
    const resolver = createImageResolver(document, [], ctx, images, stubDecoder);

    await expectGltfErrorAsync(resolver.resolve(0, 'srgb', linearSampler), 'unsupported-image-mime');
  });
});
