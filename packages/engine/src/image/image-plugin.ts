import type { AssetEvent, AssetIndex, Handle } from '@retro-engine/assets';
import type { Renderer, TextureFormat, TextureView } from '@retro-engine/renderer-core';
import { srgbVariantOf, TextureUsage } from '@retro-engine/renderer-core';

import { registerAssetKind } from '../asset/asset-kinds';
import { ASSET_TYPE, registerAssetStore } from '../asset/asset-stores';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { RenderSet } from '../render-set';
import { Res, ResMut } from '../system-param';

import { bytesPerTexel, Image } from './image';
import { Images } from './images';
import type { RenderImage } from './render-image';

/**
 * Per-frame extract-side queue: the {@link AssetEvent}s the extract system
 * pulls from {@link Images} and hands to the prepare system. Cleared at the end
 * of every prepare pass.
 *
 * Inserted by {@link ImagePlugin} as an App resource (resources are
 * App-scoped, not world-scoped, in this engine — see
 * {@link App.insertResource}).
 */
export class ExtractedImageAssetEvents {
  events: AssetEvent<Image>[] = [];
}

/**
 * Map of image {@link AssetIndex} → {@link RenderImage}, populated by the
 * prepare system. The {@link MaterialPlugin} prepare path reads this when
 * resolving `imageMode: 'handle'` schema entries — texture entries bind
 * `RenderImage.view`, sampler entries bind `RenderImage.sampler`.
 *
 * The render-side counterpart of {@link Images}. Lifetimes are tied to the
 * source `Images` resource: a `removed` event destroys the GPU resources and
 * drops the entry; a `modified` event destroys-and-reuploads. Keyed on
 * `handle.index` so lookups stay numeric on the draw hot path.
 */
export class RenderImages {
  private readonly entries = new Map<AssetIndex, RenderImage>();

  set(handle: Handle<Image>, image: RenderImage): void {
    this.entries.set(handle.index, image);
  }

  get(handle: Handle<Image>): RenderImage | undefined {
    return this.entries.get(handle.index);
  }

  has(handle: Handle<Image>): boolean {
    return this.entries.has(handle.index);
  }

  delete(handle: Handle<Image>): boolean {
    return this.entries.delete(handle.index);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Engine-internal plugin owning the image data layer.
 *
 * On `build`:
 *
 * - Inserts {@link Images} (the main-world image registry). The fresh
 *   `Images` instance carries three default handles already seeded —
 *   `WHITE`, `BLACK`, `NORMAL_FLAT` — so material schemas can fall back to
 *   them without any explicit upload.
 * - Inserts {@link ExtractedImageAssetEvents} and {@link RenderImages}.
 * - Registers a `RenderSet.Extract` system that drains pending image-asset
 *   events into {@link ExtractedImageAssetEvents}.
 * - Registers a `RenderSet.Prepare` system labelled `'image-prepare'` that
 *   consumes the queue: allocates GPU textures / views / samplers for added
 *   or modified images, destroys + drops entries for removed images, and
 *   updates {@link RenderImages}. Other plugins whose prepare step reads
 *   `RenderImages` declare `after: ['image-prepare']` so the GPU resources
 *   are ready in time.
 *
 * Unique — re-adding manually throws.
 */
export class ImagePlugin implements PluginObject {
  name(): string {
    return 'ImagePlugin';
  }

  build(app: App): void {
    if (app.getResource(Images) === undefined) app.insertResource(new Images());
    registerAssetStore(app, ASSET_TYPE.image, app.getResource(Images)!);
    // Images are source assets a user drops in, so a loose one with no sidecar is
    // discovered and gets one minted. `.hdr` decodes into the same Images store.
    registerAssetKind(app, {
      kind: ASSET_TYPE.image,
      extensions: ['png', 'jpg', 'jpeg', 'webp', 'ktx2', 'basis', 'hdr'],
      discoverable: true,
      largeBinary: true,
      category: 'image',
    });
    if (app.getResource(ExtractedImageAssetEvents) === undefined) {
      app.insertResource(new ExtractedImageAssetEvents());
    }
    if (app.getResource(RenderImages) === undefined) {
      app.insertResource(new RenderImages());
    }

    // RenderSet.Extract: drain Images' pending-change buffer into the
    // render-side queue.
    app.addSystem(
      'render',
      [ResMut(Images), ResMut(ExtractedImageAssetEvents)],
      (images, queue) => {
        const drained = images.drainEvents();
        if (drained.length === 0) return;
        for (const ev of drained) queue.events.push(ev);
      },
      { set: RenderSet.Extract, name: 'image-extract' },
    );

    // RenderSet.Prepare: consume the queue, allocate / destroy GPU resources,
    // populate RenderImages. Labelled so material-prepare systems can declare
    // `after: ['image-prepare']` and resolve handles in the same frame.
    app.addSystem(
      'render',
      [Res(Images), ResMut(ExtractedImageAssetEvents), ResMut(RenderImages)],
      (images, queue, renderImages) => {
        if (queue.events.length === 0) return;
        for (const ev of queue.events) {
          if (ev.kind === 'unused') continue;
          if (ev.kind === 'removed' || ev.kind === 'modified') {
            const existing = renderImages.get(ev.handle);
            if (existing !== undefined) {
              existing.view.destroy();
              existing.texture.destroy();
              existing.sampler.destroy();
              renderImages.delete(ev.handle);
            }
          }
          if (ev.kind === 'added' || ev.kind === 'modified') {
            const image = images.get(ev.handle);
            if (image !== undefined) uploadImage(ev.handle, image, app.renderer, renderImages);
          }
        }
        queue.events.length = 0;
      },
      { set: RenderSet.Prepare, label: 'image-prepare' },
    );
  }
}

/**
 * Upload one image to the GPU: create the texture / view / sampler, write
 * the pixel bytes, and register the resulting {@link RenderImage}. Throws on
 * `mipLevelCount > 1` (Phase 7.5 limitation), on unsupported formats, and on
 * cube images that don't carry six layers.
 */
const uploadImage = (
  handle: Handle<Image>,
  image: Image,
  renderer: Renderer,
  renderImages: RenderImages,
): void => {
  if (image.mipLevelCount > 1) {
    throw new Error(
      `ImagePlugin: image '${handle.index}' declares mipLevelCount=${image.mipLevelCount}; multi-mip uploads are not implemented in Phase 7.5 — pass mipLevelCount=1 or omit.`,
    );
  }
  const bpt = bytesPerTexel(image.format);
  if (bpt === undefined) {
    throw new Error(
      `ImagePlugin: image '${handle.index}' uses format '${image.format}', which is not a sampled colour format supported by Image.`,
    );
  }
  if (image.dimension === 'cube' && image.depthOrArrayLayers !== 6) {
    throw new Error(
      `ImagePlugin: cube image '${handle.index}' must declare depthOrArrayLayers=6; got ${image.depthOrArrayLayers}.`,
    );
  }

  // WebGPU stores cube textures as 2D textures with six array layers; the
  // cube-ness is expressed at view-creation time via dimension: 'cube'.
  const textureDimension: '2d' | '3d' = image.dimension === '3d' ? '3d' : '2d';
  // sRGB-tagged color images upload to the matching -srgb GPU format so
  // textureSample decodes to linear; linear-tagged data images upload to
  // the base format and sample raw.
  const gpuFormat: TextureFormat =
    image.colorSpace === 'srgb' ? srgbVariantOf(image.format) : image.format;
  const texture = renderer.createTexture({
    width: image.width,
    height: image.height,
    depthOrArrayLayers: image.depthOrArrayLayers,
    format: gpuFormat,
    usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
    mipLevelCount: 1,
    dimension: textureDimension,
    ...(image.label !== undefined ? { label: image.label } : {}),
  });

  renderer.writeTexture(
    { texture },
    image.data as BufferSource,
    {
      bytesPerRow: image.width * bpt,
      rowsPerImage: image.height,
    },
    {
      width: image.width,
      height: image.height,
      depthOrArrayLayers: image.depthOrArrayLayers,
    },
  );

  const viewDimension: '2d' | '2d-array' | 'cube' | '3d' =
    image.dimension === 'cube'
      ? 'cube'
      : image.dimension === '3d'
        ? '3d'
        : image.depthOrArrayLayers > 1
          ? '2d-array'
          : '2d';
  const view: TextureView = texture.createView({
    dimension: viewDimension,
    ...(image.label !== undefined ? { label: `${image.label}#view` } : {}),
  });

  const sampler = renderer.createSampler(image.sampler);

  renderImages.set(handle, { texture, view, sampler, dimension: image.dimension });
};
