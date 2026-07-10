import type { Query as QueryHandle } from '@retro-engine/ecs';
import type { App, Handle, Image, RenderImages } from '@retro-engine/engine';
import type { TextureFormat } from '@retro-engine/renderer-core';

import { ComputedLayout, UiNode } from '../ui-node';
import type { UiViewport } from '../ui-plugin';
import { UiImage } from '../ui-image';

import { UiImagePipeline } from './ui-image-pipeline';
import { packUiImage, UI_IMAGE_FLOAT_COUNT } from './ui-image-instance';
import { packUiColor } from './ui-instance';
import { computeClipRect } from './ui-prepare';

export type UiImageQuery = QueryHandle<readonly [typeof UiNode, typeof ComputedLayout, typeof UiImage]>;

/** One screen-space image rect + source UV + tint, awaiting clip-space packing. */
interface ImageItem {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  readonly tint: number;
}

/**
 * Prepare pass for UI images: place each {@link UiImage} node's texture in its
 * node's screen-space box, map to clip space, and pack into the image pipeline's
 * instance buffer grouped by source texture (one draw batch per image). Skips a
 * node whose image is unset or not yet uploaded (picked up a later frame) and
 * no-ops when there is no surface. A zero-size box (unlaid-out node) is skipped.
 */
export const prepareUiImages = (
  app: App,
  nodes: UiImageQuery,
  viewport: UiViewport,
  renderImages: RenderImages,
  pipeline: UiImagePipeline,
  targetFormat: TextureFormat,
): void => {
  pipeline.count = 0;
  pipeline.batches.length = 0;
  const surface = app.getSurface();
  if (surface === undefined) return;

  const groups = new Map<number, { image: Handle<Image>; items: ImageItem[] }>();
  let total = 0;

  for (const row of nodes.entries()) {
    const layout = row[2] as ComputedLayout;
    const img = row[3] as UiImage;
    if (img.image === undefined || layout.width <= 0 || layout.height <= 0) continue;
    if (renderImages.get(img.image) === undefined) continue;

    const tint = packUiColor(img.tint[0] as number, img.tint[1] as number, img.tint[2] as number, img.tint[3] as number);
    let group = groups.get(img.image.index);
    if (group === undefined) {
      group = { image: img.image, items: [] };
      groups.set(img.image.index, group);
    }
    group.items.push({
      x: layout.x,
      y: layout.y,
      w: layout.width,
      h: layout.height,
      u0: img.uv[0],
      v0: img.uv[1],
      u1: img.uv[2],
      v1: img.uv[3],
      tint,
    });
    total += 1;
  }

  if (total === 0) return;

  const renderer = app.renderer;
  pipeline.ensureInitialised(renderer, targetFormat);
  pipeline.ensureCapacity(renderer, total);

  const f32 = pipeline.scratchF32;
  const u32 = pipeline.scratchU32;
  const vw = viewport.width;
  const vh = viewport.height;
  let instance = 0;
  let cursor = 0;
  for (const group of groups.values()) {
    const firstInstance = instance;
    for (const item of group.items) {
      const clip = computeClipRect(item.x, item.y, item.w, item.h, vw, vh);
      packUiImage(
        clip.left,
        clip.top,
        clip.right,
        clip.bottom,
        item.u0,
        item.v0,
        item.u1,
        item.v1,
        item.tint,
        f32,
        u32,
        cursor,
      );
      cursor += UI_IMAGE_FLOAT_COUNT;
      instance += 1;
    }
    pipeline.batches.push({ image: group.image, firstInstance, count: group.items.length });
  }

  pipeline.count = total;
  if (pipeline.instanceBuffer !== undefined) {
    renderer.writeBuffer(pipeline.instanceBuffer, 0, f32.subarray(0, cursor) as unknown as BufferSource);
  }
};
