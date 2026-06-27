import type { AssetImporter } from '@retro-engine/assets';

import { Image } from './image';

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
 * Build an {@link AssetImporter} that decodes a loose PNG / JPEG / WebP file into
 * an sRGB color {@link Image} (`rgba8unorm`) — the common base-color case, so a
 * dropped-in texture can be referenced by a material.
 *
 * Loose data maps (normal / metallic-roughness / occlusion) are linear, not
 * sRGB; loading those correctly is a per-asset import setting and not inferable
 * from the file alone, so this importer always produces a color image.
 *
 * @param decode override the pixel decoder (defaults to {@link createImageBitmapRgbaDecoder}).
 */
export const createImageImporter =
  (decode: RgbaImageDecoder = createImageBitmapRgbaDecoder): AssetImporter<Image> =>
  async (bytes) => {
    const { data, width, height } = await decode(bytes);
    return Image.fromBytes({ data, format: 'rgba8unorm', colorSpace: 'srgb', width, height });
  };
