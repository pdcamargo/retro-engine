import type { AssetImporter } from '@retro-engine/assets';

import { Image } from '../image/image';
import {
  createImageBitmapRgbaDecoder,
  type RgbaImageDecoder,
} from '../image/image-importer';
import type { Images } from '../image/images';

import { Font } from './font-asset';
import { parseMsdfFont } from './msdf-parser';

/** Derive the default atlas sibling (`<base>.png`) for a font descriptor path. */
const defaultAtlasSibling = (path: string): string => {
  const clean = path.split(/[?#]/, 1)[0] ?? path;
  const base = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return `${dot > 0 ? base.slice(0, dot) : base}.png`;
};

/**
 * Build an {@link AssetImporter} for MSDF font descriptors (`.font` files, which
 * carry the JSON emitted by `msdf-atlas-gen`). The importer parses the font
 * metrics/glyphs, reads its companion atlas image, and registers that image as a
 * labeled sub-asset in `images` so the font's atlas travels with it.
 *
 * The atlas file defaults to a sibling `<base>.png`; a descriptor may override it
 * with a top-level `"image"` string. The atlas is decoded into a **linear**
 * `rgba8unorm` {@link Image} — its channels are signed distances, never colour,
 * so they must not be sRGB-decoded.
 *
 * @param images the store the decoded atlas image is registered into.
 * @param decode override the pixel decoder (defaults to the browser
 *   `createImageBitmap` decoder; inject one in headless environments).
 */
export const createFontImporter =
  (images: Images, decode: RgbaImageDecoder = createImageBitmapRgbaDecoder): AssetImporter<Font> =>
  async (bytes, ctx) => {
    const json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const data = parseMsdfFont(json);

    const imageRef = typeof json.image === 'string' ? json.image : defaultAtlasSibling(ctx.path);
    const atlasBytes = await ctx.read(imageRef);
    const decoded = await decode(atlasBytes);

    const atlas = Image.fromBytes({
      data: decoded.data,
      format: 'rgba8unorm',
      colorSpace: 'linear',
      width: decoded.width,
      height: decoded.height,
      label: `font-atlas:${imageRef}`,
    });
    const atlasHandle = ctx.addLabeledAsset('Atlas', atlas, images);

    return new Font(data, atlasHandle);
  };
