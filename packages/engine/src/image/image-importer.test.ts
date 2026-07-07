import type { LoadContext } from '@retro-engine/assets';
import { describe, expect, it } from 'bun:test';

import { createImageImporter } from './image-importer';

const ctx = {} as LoadContext;

describe('createImageImporter', () => {
  it('decodes via the injected decoder into an sRGB rgba8unorm Image', async () => {
    const importer = createImageImporter(async () => ({
      data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]), // 2×1 red, green
      width: 2,
      height: 1,
    }));

    const image = await importer(new Uint8Array([1, 2, 3]), ctx);

    expect(image.width).toBe(2);
    expect(image.height).toBe(1);
    expect(image.format).toBe('rgba8unorm');
    expect(image.colorSpace).toBe('srgb');
    expect(image.data[0]).toBe(255);
    // Default sampler is linear (the base-color case).
    expect(image.sampler.magFilter).toBe('linear');
  });

  it('applies default import settings (e.g. a pixel-art nearest/linear-data importer)', async () => {
    const decode = async () => ({ data: new Uint8Array([1, 2, 3, 4]), width: 1, height: 1 });
    const importer = createImageImporter(decode, {
      filter: 'nearest',
      wrap: 'repeat',
      colorSpace: 'linear',
    });
    const image = await importer(new Uint8Array([0]), ctx);
    expect(image.colorSpace).toBe('linear');
    expect(image.sampler.magFilter).toBe('nearest');
    expect(image.sampler.minFilter).toBe('nearest');
    expect(image.sampler.addressModeU).toBe('repeat');
    expect(image.sampler.addressModeV).toBe('repeat');
  });

  it('lets a per-asset .meta sidecar override the importer default', async () => {
    const decode = async () => ({ data: new Uint8Array([1, 2, 3, 4]), width: 1, height: 1 });
    // Default: linear/srgb; the sidecar flips filter to nearest, colorSpace to linear.
    const importer = createImageImporter(decode);
    const metaCtx = {
      path: 'textures/wood.png',
      read: async (rel: string) => {
        if (rel === 'wood.png.meta') {
          return new TextEncoder().encode(JSON.stringify({ filter: 'nearest', colorSpace: 'linear' }));
        }
        throw new Error(`unexpected read: ${rel}`);
      },
    } as unknown as LoadContext;

    const image = await importer(new Uint8Array([0]), metaCtx);
    expect(image.sampler.magFilter).toBe('nearest'); // from .meta
    expect(image.colorSpace).toBe('linear'); // from .meta
  });

  it('falls back to the default when the .meta sidecar is absent', async () => {
    const decode = async () => ({ data: new Uint8Array([1, 2, 3, 4]), width: 1, height: 1 });
    const importer = createImageImporter(decode, { filter: 'nearest' });
    const noMetaCtx = {
      path: 'textures/wood.png',
      read: async () => {
        throw new Error('ENOENT'); // no sidecar
      },
    } as unknown as LoadContext;

    const image = await importer(new Uint8Array([0]), noMetaCtx);
    expect(image.sampler.magFilter).toBe('nearest'); // importer default preserved
    expect(image.colorSpace).toBe('srgb');
  });

  it('rejects when the decoded byte length does not match the dimensions', async () => {
    const importer = createImageImporter(async () => ({
      data: new Uint8Array([255, 0, 0]), // too short for 2×1 rgba8
      width: 2,
      height: 1,
    }));
    await expect(importer(new Uint8Array([0]), ctx)).rejects.toThrow();
  });
});
