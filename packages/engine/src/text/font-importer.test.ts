import { describe, expect, it } from 'bun:test';

import type { Assets, Handle } from '@retro-engine/assets';

import { Image } from '../image/image';
import { Images } from '../image/images';

import { Font } from './font-asset';
import { createFontImporter } from './font-importer';
import type { MsdfFontJson } from './msdf-parser';

const FONT: MsdfFontJson = {
  atlas: { type: 'msdf', distanceRange: 4, size: 32, width: 64, height: 64, yOrigin: 'bottom' },
  metrics: { emSize: 1, lineHeight: 1.25, ascender: 0.8, descender: -0.2 },
  glyphs: [
    { unicode: 32, advance: 0.25 },
    {
      unicode: 65,
      advance: 0.5,
      planeBounds: { left: 0, bottom: 0, right: 0.5, top: 0.7 },
      atlasBounds: { left: 0, bottom: 0, right: 32, top: 45 },
    },
  ],
};

const encode = (obj: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(obj));

interface FakeCtx {
  path: string;
  read(rel: string): Promise<Uint8Array>;
  addLabeledAsset<U>(label: string, value: U, store: Assets<U>): Handle<U>;
}

function fakeCtx(
  path: string,
  files: Record<string, Uint8Array>,
): { ctx: FakeCtx; added: Array<{ label: string; value: unknown }> } {
  const added: Array<{ label: string; value: unknown }> = [];
  return {
    added,
    ctx: {
      path,
      read: (rel) => {
        const bytes = files[rel];
        if (bytes === undefined) return Promise.reject(new Error(`missing sibling '${rel}'`));
        return Promise.resolve(bytes);
      },
      addLabeledAsset: (label, value, store) => {
        added.push({ label, value });
        return store.reserveHandle();
      },
    },
  };
}

const fakeDecoder = (width: number, height: number) => async () => ({
  data: new Uint8Array(width * height * 4),
  width,
  height,
});

describe('createFontImporter', () => {
  it('parses the descriptor and registers a linear atlas sub-asset', async () => {
    const images = new Images();
    const importer = createFontImporter(images, fakeDecoder(64, 64));
    const { ctx, added } = fakeCtx('fonts/Test.font', { 'Test.png': new Uint8Array([1]) });

    const font = await importer(encode(FONT), ctx as never);

    expect(font).toBeInstanceOf(Font);
    expect(font.data.glyphCount).toBe(2);
    expect(font.data.glyph(65)?.advance).toBe(0.5);
    expect(font.atlas).toBeDefined();

    // The atlas is registered as an 'Atlas' sub-asset, linear (distance field).
    expect(added).toHaveLength(1);
    expect(added[0]?.label).toBe('Atlas');
    const atlas = added[0]?.value as Image;
    expect(atlas).toBeInstanceOf(Image);
    expect(atlas.colorSpace).toBe('linear');
    expect(atlas.width).toBe(64);
    expect(atlas.height).toBe(64);
  });

  it('derives the atlas sibling from the descriptor path by default', async () => {
    const importer = createFontImporter(new Images(), fakeDecoder(64, 64));
    const { ctx } = fakeCtx('a/b/Roboto.font', { 'Roboto.png': new Uint8Array([1]) });
    const font = await importer(encode(FONT), ctx as never);
    expect(font).toBeInstanceOf(Font);
  });

  it('honors an explicit "image" override in the descriptor', async () => {
    const importer = createFontImporter(new Images(), fakeDecoder(64, 64));
    const withImage = { ...FONT, image: 'atlas/custom.png' };
    const { ctx } = fakeCtx('fonts/Test.font', { 'atlas/custom.png': new Uint8Array([1]) });
    const font = await importer(encode(withImage), ctx as never);
    expect(font).toBeInstanceOf(Font);
  });

  it('rejects when the atlas sibling is missing', async () => {
    const importer = createFontImporter(new Images(), fakeDecoder(64, 64));
    const { ctx } = fakeCtx('fonts/Test.font', {});
    await expect(importer(encode(FONT), ctx as never)).rejects.toThrow(/missing sibling/);
  });

  it('propagates a malformed descriptor as a parse error', async () => {
    const importer = createFontImporter(new Images(), fakeDecoder(64, 64));
    const { ctx } = fakeCtx('fonts/Test.font', { 'Test.png': new Uint8Array([1]) });
    await expect(importer(encode({ atlas: FONT.atlas }), ctx as never)).rejects.toThrow(/metrics/);
  });

  it('exposes layout/measure convenience through the Font', async () => {
    const importer = createFontImporter(new Images(), fakeDecoder(64, 64));
    const { ctx } = fakeCtx('fonts/Test.font', { 'Test.png': new Uint8Array([1]) });
    const font = await importer(encode(FONT), ctx as never);
    const measure = font.measure('A', { fontSize: 100 });
    expect(measure.width).toBeCloseTo(50);
    expect(font.layout('A', { fontSize: 100 }).glyphs).toHaveLength(1);
  });
});
