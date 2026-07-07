import type { AssetImporter } from '@retro-engine/assets';

import { Image } from './image';
import {
  resolveTextureColorSpace,
  resolveTextureSampler,
  type TextureImportSettings,
} from './texture-import-settings';

/** RGBA8 pixels decoded from an encoded image (PNG / JPEG / WebP). */
export interface DecodedRgba {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * Decodes encoded image bytes (PNG / JPEG / WebP) into RGBA8 pixels. Injectable
 * so the importer stays unit-testable where the browser image APIs are absent.
 */
export type RgbaImageDecoder = (bytes: Uint8Array) => Promise<DecodedRgba>;

/**
 * Default {@link RgbaImageDecoder} built on `createImageBitmap` + `OffscreenCanvas`
 * (available in a browser and in the Tauri webview). Throws where those globals
 * are missing (e.g. headless Bun), where the caller must inject a decoder.
 *
 * The bytes are kept in their base form (`rgba8unorm`); the sRGB transfer is
 * applied at bind time from the {@link Image}'s `colorSpace`.
 */
export const createImageBitmapRgbaDecoder: RgbaImageDecoder = async (bytes) => {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new Error(
      'createImageBitmapRgbaDecoder needs the browser createImageBitmap + OffscreenCanvas APIs; ' +
        'inject a different RgbaImageDecoder in this environment.',
    );
  }
  // Copy into a fresh buffer: the source may be a subarray of a larger backing store.
  const bitmap = await createImageBitmap(new Blob([bytes.slice()]));
  try {
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('OffscreenCanvas 2D context unavailable; cannot read decoded pixels.');
    context.drawImage(bitmap, 0, 0);
    return { data: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer), width, height };
  } finally {
    bitmap.close();
  }
};

/**
 * Build an `rgba8unorm` {@link Image} from decoded pixels, applying texture
 * import `settings` (filter / wrap → sampler, `colorSpace`). Omitted settings
 * default to a linear-filtered, clamped, sRGB color image — the common
 * base-color case. Pure.
 */
export const imageFromDecoded = (decoded: DecodedRgba, settings: TextureImportSettings = {}): Image =>
  Image.fromBytes({
    data: decoded.data,
    format: 'rgba8unorm',
    width: decoded.width,
    height: decoded.height,
    colorSpace: resolveTextureColorSpace(settings),
    sampler: resolveTextureSampler(settings),
  });

/**
 * Build an {@link AssetImporter} that decodes a loose PNG / JPEG / WebP file into
 * an `rgba8unorm` {@link Image}, so a dropped-in texture can be referenced by a
 * material.
 *
 * `settings` are the **default** texture import settings applied to every image
 * this importer produces — e.g. a pixel-art project registers the importer with
 * `{ filter: 'nearest' }`. Per-asset overrides (a `.meta` sidecar) are a later
 * phase; until then a data map (normal / metallic-roughness) needs its own
 * importer registration with `{ colorSpace: 'linear' }`.
 *
 * @param decode override the pixel decoder (defaults to {@link createImageBitmapRgbaDecoder}).
 * @param settings default import settings for every produced image.
 */
export const createImageImporter =
  (
    decode: RgbaImageDecoder = createImageBitmapRgbaDecoder,
    settings: TextureImportSettings = {},
  ): AssetImporter<Image> =>
  async (bytes) =>
    imageFromDecoded(await decode(bytes), settings);
