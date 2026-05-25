import { describe, expect, it } from 'bun:test';

import { vec4 } from '@retro-engine/math';

import { App } from '../index';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { Image } from './image';
import { ExtractedImageAssetEvents, RenderImages } from './image-plugin';
import { Images } from './images';

describe('ImagePlugin', () => {
  it('inserts Images, ExtractedImageAssetEvents, RenderImages on build', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    // ImagePlugin is registered automatically by CorePlugin — no explicit
    // addPlugin call here.
    expect(app.getResource(Images)).toBeInstanceOf(Images);
    expect(app.getResource(ExtractedImageAssetEvents)).toBeInstanceOf(ExtractedImageAssetEvents);
    expect(app.getResource(RenderImages)).toBeInstanceOf(RenderImages);
  });

  it('populates RenderImages with the three default handles after one frame', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    // ImagePlugin is registered automatically by CorePlugin — no explicit
    // addPlugin call here.
    const images = app.getResource(Images)!;
    await app.run();
    const renderImages = app.getResource(RenderImages)!;
    expect(renderImages.has(images.WHITE)).toBe(true);
    expect(renderImages.has(images.BLACK)).toBe(true);
    expect(renderImages.has(images.NORMAL_FLAT)).toBe(true);
    expect(renderImages.size).toBe(3);
  });

  it('uploads a user-registered image on the frame it is added', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    // ImagePlugin is registered automatically by CorePlugin — no explicit
    // addPlugin call here.
    const images = app.getResource(Images)!;
    const handle = images.add(Image.solid(vec4.create(1, 0, 0, 1), undefined, 'red-test'));
    await app.run();
    const renderImages = app.getResource(RenderImages)!;
    const entry = renderImages.get(handle);
    expect(entry).toBeDefined();
    expect(entry?.texture).toBeDefined();
    expect(entry?.view).toBeDefined();
    expect(entry?.sampler).toBeDefined();
  });

  it('throws when an image declares mipLevelCount > 1', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    // ImagePlugin is registered automatically by CorePlugin — no explicit
    // addPlugin call here.
    const images = app.getResource(Images)!;
    images.add(
      new Image({
        data: new Uint8Array(4),
        format: 'rgba8unorm',
        width: 1,
        height: 1,
        mipLevelCount: 2,
      }),
    );
    await expect(app.run()).rejects.toThrow(/mipLevelCount=2/);
  });

  it('destroys GPU resources on Removed', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    // ImagePlugin is registered automatically by CorePlugin — no explicit
    // addPlugin call here.
    const images = app.getResource(Images)!;
    const handle = images.add(Image.solid(vec4.create(1, 1, 1, 1)));
    await app.run();
    const renderImages = app.getResource(RenderImages)!;
    const entry = renderImages.get(handle)!;
    let textureDestroyed = false;
    let viewDestroyed = false;
    let samplerDestroyed = false;
    const wrappedTexture = entry.texture;
    const originalTexDestroy = wrappedTexture.destroy.bind(wrappedTexture);
    wrappedTexture.destroy = () => {
      textureDestroyed = true;
      originalTexDestroy();
    };
    const originalViewDestroy = entry.view.destroy.bind(entry.view);
    entry.view.destroy = () => {
      viewDestroyed = true;
      originalViewDestroy();
    };
    const originalSamplerDestroy = entry.sampler.destroy.bind(entry.sampler);
    entry.sampler.destroy = () => {
      samplerDestroyed = true;
      originalSamplerDestroy();
    };

    images.remove(handle);
    app.advanceFrame(performance.now());
    expect(renderImages.has(handle)).toBe(false);
    expect(textureDestroyed).toBe(true);
    expect(viewDestroyed).toBe(true);
    expect(samplerDestroyed).toBe(true);
  });
});
