import type { Assets, Handle, Image as ImageType, LoadContext } from '@retro-engine/engine';
import { Image } from '@retro-engine/engine';
import type { SamplerDescriptor } from '@retro-engine/renderer-core';

import { sliceBufferView } from './buffers';
import { GltfImportError } from './gltf-error';
import type { ImageDecoder } from './image-decoder';
import { detectImageMime } from './image-source';
import type { GltfDocument } from './schema';

/** Color-space tag an image is decoded under, per the material slot that uses it. */
export type ImageColorSpace = 'srgb' | 'linear';

const samplerKey = (s: SamplerDescriptor): string =>
  `${s.addressModeU}/${s.addressModeV}/${s.magFilter}/${s.minFilter}/${s.mipmapFilter}`;

/**
 * Resolves glTF texture images to deduped `Image` sub-assets within one load.
 *
 * One {@link Handle} is minted per unique `(image source, color space, sampler)`
 * combination: an image referenced by several materials under the same color
 * space and sampler is decoded and registered once. A source reused under a
 * divergent sampler or color space is **duplicated** — the engine binds one
 * sampler per `Image` and each `Image` carries a single color space, so the
 * divergent use needs its own asset.
 */
export interface ImageResolver {
  /** Resolve the image at `imageIndex` for the given slot color space + sampler. */
  resolve(
    imageIndex: number,
    colorSpace: ImageColorSpace,
    sampler: SamplerDescriptor,
  ): Promise<Handle<ImageType>>;
  /** Every `Image` handle minted so far, in registration order. */
  readonly handles: readonly Handle<ImageType>[];
}

/**
 * Builds an {@link ImageResolver} bound to one load's document, buffers, decode
 * port, and `Image` store. Registers each decoded image through
 * `ctx.addLabeledAsset` with an `Image{n}` label.
 */
export const createImageResolver = (
  document: GltfDocument,
  buffers: readonly Uint8Array[],
  ctx: LoadContext,
  images: Assets<ImageType>,
  decoder: ImageDecoder,
): ImageResolver => {
  const cache = new Map<string, Handle<ImageType>>();
  const handles: Handle<ImageType>[] = [];

  const sourceBytes = async (imageIndex: number): Promise<{ bytes: Uint8Array; sourceKey: string }> => {
    const image = document.images?.[imageIndex];
    if (image === undefined) {
      throw new GltfImportError('missing-resource', `glTF image ${imageIndex} does not exist.`);
    }
    if (image.uri !== undefined) {
      return { bytes: await ctx.read(image.uri), sourceKey: `uri:${image.uri}` };
    }
    if (image.bufferView !== undefined) {
      return {
        bytes: sliceBufferView(document, buffers, image.bufferView),
        sourceKey: `bv:${image.bufferView}`,
      };
    }
    throw new GltfImportError(
      'missing-resource',
      `glTF image ${imageIndex} has neither a uri nor a bufferView.`,
    );
  };

  const resolve = async (
    imageIndex: number,
    colorSpace: ImageColorSpace,
    sampler: SamplerDescriptor,
  ): Promise<Handle<ImageType>> => {
    const { bytes, sourceKey } = await sourceBytes(imageIndex);
    const key = `${sourceKey}|${colorSpace}|${samplerKey(sampler)}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const meta = document.images?.[imageIndex];
    const mime = detectImageMime(bytes, {
      ...(meta?.mimeType !== undefined ? { mimeType: meta.mimeType } : {}),
      ...(meta?.uri !== undefined ? { uri: meta.uri } : {}),
    });
    if (mime === 'image/ktx2') {
      throw new GltfImportError(
        'unsupported-image-mime',
        'KTX2 image decode is deferred (KHR_texture_basisu); supply a KTX2-capable ImageDecoder.',
      );
    }

    const pixels = await decoder(bytes, mime);
    const image = new Image({
      data: pixels.data,
      format: pixels.format,
      width: pixels.width,
      height: pixels.height,
      colorSpace,
      sampler,
      label: `Image${handles.length}`,
    });
    const handle = ctx.addLabeledAsset(`Image${handles.length}`, image, images);
    handles.push(handle);
    cache.set(key, handle);
    return handle;
  };

  return { resolve, handles };
};
