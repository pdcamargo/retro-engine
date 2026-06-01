import type { TextureFormat } from '@retro-engine/renderer-core';

import { GltfImportError } from './gltf-error';
import type { SupportedImageMime } from './image-source';

/**
 * Raw pixels produced by an {@link ImageDecoder}, ready to hand to the engine
 * `Image` asset.
 *
 * `data` is tightly packed `width × height × bytesPerTexel(format)` bytes, top
 * row first. `format` is a renderer-core **base** format (e.g. `'rgba8unorm'`);
 * the sRGB-vs-linear choice is the caller's, applied through the `Image`'s
 * `colorSpace`, not encoded here.
 */
export interface DecodedImagePixels {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
}

/**
 * Turns compressed image bytes (PNG / JPEG) into raw pixels.
 *
 * The glTF mapping consumes decoding through this port rather than depending on
 * a concrete codec, so the package ships no image-codec dependency and the
 * mapping stays unit-testable with a stub. Provide a real decoder when wiring
 * the importer; {@link createImageBitmapDecoder} is the browser / webview
 * default. A future KTX2 / Basis decoder is another implementation of this same
 * port.
 */
export type ImageDecoder = (
  bytes: Uint8Array,
  mime: SupportedImageMime,
) => Promise<DecodedImagePixels>;

/**
 * Default {@link ImageDecoder} built on `createImageBitmap` + `OffscreenCanvas`,
 * decoding PNG / JPEG to RGBA8. Available in a browser and in the Tauri webview;
 * it throws in environments without those globals (e.g. headless Bun), where the
 * caller must inject a different decoder.
 *
 * Returns `format: 'rgba8unorm'` — the sRGB transfer is applied at bind time
 * from the `Image`'s `colorSpace`, so the bytes stay in their base form here.
 */
export const createImageBitmapDecoder: ImageDecoder = async (bytes, mime) => {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new GltfImportError(
      'unsupported-image-mime',
      'createImageBitmapDecoder needs the browser createImageBitmap + OffscreenCanvas APIs; ' +
        'inject a different ImageDecoder in this environment.',
    );
  }
  // Copy into a fresh ArrayBuffer-backed view: the source may be a subarray of a
  // larger GLB/bufferView buffer, and Blob would otherwise capture the whole
  // backing store.
  const blob = new Blob([bytes.slice()], { type: mime });
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new GltfImportError(
        'unsupported-image-mime',
        'OffscreenCanvas 2D context unavailable; cannot read decoded image pixels.',
      );
    }
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    return { data: new Uint8Array(data.buffer), width, height, format: 'rgba8unorm' };
  } finally {
    bitmap.close();
  }
};
